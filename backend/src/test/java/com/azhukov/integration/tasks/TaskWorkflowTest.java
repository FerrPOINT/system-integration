package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.azhukov.integration.support.PostgresTest;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

class TaskWorkflowTest extends PostgresTest {
    @Test
    void sessionCsrfAndLogoutAreEnforcedAtTheHttpBoundary() throws Exception {
        status(401, mvc.perform(get("/api/session")).andReturn());
        status(
                401,
                mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content(CREATE)).andReturn());
        var anonymous = mvc.perform(get("/api/csrf")).andReturn();
        var session = (MockHttpSession) anonymous.getRequest().getSession();
        String token = body(anonymous).get("token").asString();
        status(
                401,
                mvc.perform(
                                post("/api/login")
                                        .session(session)
                                        .header("X-CSRF-TOKEN", token)
                                        .param("username", "initiator.one")
                                        .param("password", "incorrect"))
                        .andReturn());
        var client = login("INITIATOR.ONE");
        status(
                403,
                mvc.perform(
                                post("/api/tasks")
                                        .session(client.session())
                                        .header("Idempotency-Key", UUID.randomUUID())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(CREATE))
                        .andReturn());
        status(
                403,
                mvc.perform(post("/api/logout").session(client.session()).header("X-CSRF-TOKEN", "invalid"))
                        .andReturn());
        var identity = mvc.perform(get("/api/session").session(client.session())).andReturn();
        status(200, identity);
        assertEquals(first.toString(), body(identity).get("userId").asString());
        assertFalse(body(identity).has("password"));
        status(
                204,
                mvc.perform(post("/api/logout").session(client.session()).header("X-CSRF-TOKEN", client.csrf()))
                        .andReturn());
        status(401, mvc.perform(get("/api/tasks")).andReturn());
    }

    @Test
    void ownershipAndRoleCannotBeBypassedWithDirectRequests() throws Exception {
        var owner = login("initiator.one");
        UUID taskId = created(owner, UUID.randomUUID());
        var other = login("initiator.two");
        status(404, mvc.perform(get("/api/tasks/" + taskId).session(other.session())).andReturn());
        status(404, mvc.perform(get("/api/tasks/" + taskId + "/history").session(other.session())).andReturn());
        status(404, rename(other, taskId, UUID.randomUUID(), "Чужое", 1));
        status(403, mvc.perform(get("/api/exchange/issues").session(owner.session())).andReturn());
        var otherList = mvc.perform(get("/api/tasks").session(other.session())).andReturn();
        assertEquals(0, body(otherList).get("items").size());
        var op = login("operator");
        status(200, mvc.perform(get("/api/tasks/" + taskId).session(op.session())).andReturn());
        status(403, create(op, UUID.randomUUID(), CREATE));
        status(403, rename(op, taskId, UUID.randomUUID(), "Нельзя", 1));
    }

    @Test
    void parallelCreateReplaysOneCommittedTaskAndRejectsDifferentPayload() throws Exception {
        var owner = login("initiator.one");
        UUID key = UUID.randomUUID();
        List<MvcResult> results;
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            results =
                    pool
                            .invokeAll(
                                    List.<Callable<MvcResult>>of(
                                            () -> create(owner, key, CREATE),
                                            () -> create(owner, key, CREATE),
                                            () -> create(owner, key, CREATE)))
                            .stream()
                            .map(f -> {
                                try {
                                    return f.get();
                                } catch (Exception e) {
                                    throw new RuntimeException(e);
                                }
                            })
                            .toList();
        }
        for (var response : results) {
            status(201, response);
            assertEquals(body(results.getFirst()), body(response));
        }
        assertEquals(1, count("tasks"));
        assertEquals(1, count("delivery_queue"));
        assertEquals(1, count("command_receipts"));
        assertEquals(1, count("task_history"));
        status(409, create(owner, key, CREATE.replace("25", "26")));
        // Command identity is scoped to the actor; another user may use the same key.
        status(201, create(login("initiator.two"), key, CREATE));
        assertEquals(2, count("tasks"));
    }

    @Test
    void concurrentRenameDoesNotLoseAnUpdateAndReceiptReturnsOriginalAnswer() throws Exception {
        var owner = login("initiator.one");
        UUID id = created(owner, UUID.randomUUID());
        var key = UUID.randomUUID();
        status(200, rename(owner, id, key, "Первое имя", 1));
        MvcResult a;
        MvcResult b;
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var one = pool.submit(() -> rename(owner, id, UUID.randomUUID(), "Второе имя", 2));
            var two = pool.submit(() -> rename(owner, id, UUID.randomUUID(), "Третье имя", 2));
            a = one.get();
            b = two.get();
        }
        assertEquals(
                List.of(200, 409),
                List.of(a.getResponse().getStatus(), b.getResponse().getStatus()).stream().sorted().toList());
        var replay = rename(owner, id, key, "Первое имя", 1);
        status(200, replay);
        assertEquals(2, body(replay).get("titleRevision").asInt());
        var current = mvc.perform(get("/api/tasks/" + id).session(owner.session())).andReturn();
        assertEquals(3, body(current).get("titleRevision").asInt());
        assertNotEquals("Первое имя", body(current).get("title").asString());
        assertEquals(3, count("task_history"));
    }

    @Test
    void enqueueFailureRollsBackTaskReceiptAndHistory() throws Exception {
        var owner = login("initiator.one");
        jdbc.execute(
                """
                CREATE FUNCTION test_reject_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Test failure before enqueue'; END; $$
                """);
        jdbc.execute(
                "CREATE TRIGGER test_enqueue_failure BEFORE INSERT ON delivery_queue FOR EACH ROW EXECUTE FUNCTION test_reject_enqueue()");
        try {
            assertThrows(Exception.class, () -> create(owner, UUID.randomUUID(), CREATE));
            for (String table : List.of("tasks", "delivery_queue", "command_receipts", "task_history"))
                assertEquals(0, count(table));
        } finally {
            jdbc.execute("DROP TRIGGER test_enqueue_failure ON delivery_queue");
            jdbc.execute("DROP FUNCTION test_reject_enqueue()");
        }
    }

    @Test
    void historyIsAppendOnlyAndCannotBeWrittenThroughApi() throws Exception {
        var owner = login("initiator.one");
        UUID id = created(owner, UUID.randomUUID());
        var result = mvc.perform(get("/api/tasks/" + id + "/history").session(owner.session())).andReturn();
        status(200, result);
        var event = body(result).get("items").get(0);
        assertEquals("CREATED", event.get("type").asString());
        assertEquals(first.toString(), event.get("actorUserId").asString());
        assertThrows(DataAccessException.class, () -> jdbc.update("UPDATE task_history SET summary = 'forged'"));
        assertThrows(DataAccessException.class, () -> jdbc.update("DELETE FROM task_history"));
        for (int i = 1; i <= 20; i++) status(200, rename(owner, id, UUID.randomUUID(), "История " + i, i));
        var history =
                mvc.perform(get("/api/tasks/" + id + "/history").param("page", "1").session(owner.session()))
                        .andReturn();
        assertEquals(21, body(history).get("totalItems").asLong());
        assertEquals(2, body(history).get("totalPages").asLong());
        assertEquals(1, body(history).get("items").size());
        status(
                405,
                mvc.perform(
                                post("/api/tasks/" + id + "/history")
                                        .session(owner.session())
                                        .header("X-CSRF-TOKEN", owner.csrf())
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{}"))
                        .andReturn());
    }

    @Test
    void registryPaginationAndHalfOpenUtcPeriodAreStable() throws Exception {
        var owner = login("initiator.one");
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        for (int i = 0; i < 22; i++) {
            jdbc.update(
                    """
                    INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,created_at)
                    VALUES (?,?,?,'Проверка','REQ-000001',1,?)
                    """,
                    UUID.randomUUID(),
                    first,
                    UUID.randomUUID(),
                    at.plusSeconds(i));
        }
        var result =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("createdFrom", at.toString())
                                        .param("createdTo", at.plusSeconds(21).toString()))
                        .andReturn();
        status(200, result);
        assertEquals(20, body(result).get("items").size());
        assertTrue(body(result).get("hasNext").asBoolean());
        assertEquals(21, body(result).get("totalItems").asLong());
        assertEquals(2, body(result).get("totalPages").asLong());
        assertEquals(
                at.plusSeconds(20).toInstant(),
                OffsetDateTime.parse(body(result).at("/items/0/createdAt").asString()).toInstant());
        var next =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("page", "1")
                                        .param("createdFrom", at.toString())
                                        .param("createdTo", at.plusSeconds(21).toString()))
                        .andReturn();
        assertEquals(1, body(next).get("items").size());
        assertFalse(body(next).get("hasNext").asBoolean());
        assertEquals(21, body(next).get("totalItems").asLong());
        var beyond =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("page", "999")
                                        .param("createdFrom", at.toString())
                                        .param("createdTo", at.plusSeconds(21).toString()))
                        .andReturn();
        assertEquals(0, body(beyond).get("items").size());
        assertEquals(21, body(beyond).get("totalItems").asLong());
        assertEquals(2, body(beyond).get("totalPages").asLong());
        var privateCount = mvc.perform(get("/api/tasks").session(login("initiator.two").session())).andReturn();
        assertEquals(0, body(privateCount).get("totalItems").asLong());
        var allCount = mvc.perform(get("/api/tasks").session(login("operator").session())).andReturn();
        assertEquals(22, body(allCount).get("totalItems").asLong());
        var filtered =
                mvc.perform(get("/api/tasks").session(owner.session()).param("businessStatus", "SUCCEEDED"))
                        .andReturn();
        assertEquals(0, body(filtered).get("items").size());
        assertEquals(0, body(filtered).get("totalItems").asLong());
        assertEquals(0, body(filtered).get("totalPages").asLong());
        status(400, mvc.perform(get("/api/tasks").session(owner.session()).param("page", "-1")).andReturn());
        status(
                400,
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("createdFrom", at.toString())
                                        .param("createdTo", at.toString()))
                        .andReturn());
    }

    @Test
    void utcBoundariesAndEqualTimeOrderingRemainScopedAndUnambiguous() throws Exception {
        var owner = login("initiator.one");
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        var ids =
                List.of(
                        UUID.fromString("10000000-0000-4000-8000-000000000001"),
                        UUID.fromString("10000000-0000-4000-8000-000000000002"),
                        UUID.fromString("10000000-0000-4000-8000-000000000003"));
        for (int n = 0; n < 3; n++)
            jdbc.update(
                    """
                    INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,created_at)
                    VALUES (?,?,?,'Граница UTC','REQ-000001',25,?)
                    """,
                    ids.get(n),
                    first,
                    UUID.randomUUID(),
                    n == 2 ? at.plusSeconds(1) : at);
        jdbc.update(
                """
                INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,created_at)
                VALUES (?,?,?,'Другой владелец','REQ-000001',25,?)
                """,
                UUID.randomUUID(),
                second,
                UUID.randomUUID(),
                at);
        var interval =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("createdFrom", at.toString())
                                        .param("createdTo", at.plusSeconds(1).toString()))
                        .andReturn();
        status(200, interval);
        assertEquals(2, body(interval).get("totalItems").asInt());
        assertEquals(ids.get(1).toString(), body(interval).at("/items/0/taskId").asString());
        assertEquals(ids.get(0).toString(), body(interval).at("/items/1/taskId").asString());
        var upper =
                mvc.perform(get("/api/tasks").session(owner.session()).param("createdTo", at.toString())).andReturn();
        status(200, upper);
        assertEquals(0, body(upper).get("totalItems").asInt());
        var lower =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("createdFrom", at.plusSeconds(1).toString()))
                        .andReturn();
        status(200, lower);
        assertEquals(1, body(lower).get("totalItems").asInt());
        for (String invalid :
                List.of(
                        at.withOffsetSameInstant(java.time.ZoneOffset.ofHours(3)).toString(),
                        "2026-11-10T12:00:00",
                        "2026-13-10T12:00:00Z"))
            status(
                    400,
                    mvc.perform(get("/api/tasks").session(owner.session()).param("createdFrom", invalid)).andReturn());
    }

    @Test
    void invalidFieldsAndUnknownPropertiesDoNotCreatePartialState() throws Exception {
        var owner = login("initiator.one");
        for (String invalid :
                List.of(
                        CREATE.replace("25", "0"),
                        CREATE.replace("25", "25.5"),
                        CREATE.replace("25", "\"25\""),
                        CREATE.replace("REQ-000001", "other"),
                        CREATE.replace("Проверка заявки", "  "),
                        CREATE.replace("\"title\":", "\"ownerId\":\"" + second + "\",\"title\":"))) {
            status(400, create(owner, UUID.randomUUID(), invalid));
        }
        assertEquals(0, count("tasks"));
    }

    @Test
    void unicodeBlankTitlesAreClientErrorsAndNeverCreateOrRenameState() throws Exception {
        var owner = login("initiator.one");
        var blanks = List.of("\u2003", "\u3000", "\u00a0");
        for (String blank : blanks)
            status(400, create(owner, UUID.randomUUID(), CREATE.replace("Проверка заявки", blank)));
        assertEquals(0, count("tasks"));
        assertEquals(0, count("delivery_queue"));
        assertEquals(0, count("task_history"));
        assertEquals(0, count("command_receipts"));
        var id = created(owner, UUID.randomUUID());
        for (String blank : blanks) status(400, rename(owner, id, UUID.randomUUID(), blank, 1));
        assertEquals(1, jdbc.queryForObject("SELECT title_revision FROM tasks WHERE id=?", Long.class, id));
        status(200, rename(owner, id, UUID.randomUUID(), "Имя\u2003объекта", 1));
    }

    @Test
    void nulCannotReachStorageOnCreateOrRenameAndValidUnicodeIsPreserved() throws Exception {
        var owner = login("initiator.one");
        String invalid = "До" + Character.toString(0) + "после";
        var input =
                json.writeValueAsString(
                        java.util.Map.of(
                                "title",
                                invalid,
                                "request",
                                java.util.Map.of("reference", "REQ-000001", "quantity", 25)));
        var rejected = create(owner, UUID.randomUUID(), input);
        status(400, rejected);
        assertEquals("VALIDATION_FAILED", body(rejected).get("code").asString());
        for (var table : List.of("tasks", "delivery_queue", "task_history", "command_receipts"))
            assertEquals(0, count(table));
        var valid = CREATE.replace("Проверка заявки", "Название 😀");
        var accepted = create(owner, UUID.randomUUID(), valid);
        status(201, accepted);
        var id = UUID.fromString(body(accepted).get("taskId").asString());
        var rename = rename(owner, id, UUID.randomUUID(), invalid, 1);
        status(400, rename);
        assertEquals("VALIDATION_FAILED", body(rename).get("code").asString());
        assertEquals("Название 😀", jdbc.queryForObject("SELECT title FROM tasks WHERE id=?", String.class, id));
        assertEquals(1, count("task_history"));
        assertEquals(1, count("command_receipts"));
        assertNotNull(rename.getResponse().getHeader("X-Request-ID"));
    }

    @Test
    void escapedSurrogatesAreRejectedBeforeStorageAndDoNotConsumeTheCommandKey() throws Exception {
        var owner = login("initiator.one");
        for (String escape : List.of("\\uD800", "\\uDC00")) {
            var key = UUID.randomUUID();
            var rejected = create(owner, key, CREATE.replace("Проверка заявки", "before" + escape + "after"));
            status(400, rejected);
            assertEquals("VALIDATION_FAILED", body(rejected).get("code").asString());
            for (String table : List.of("tasks", "delivery_queue", "task_history", "command_receipts"))
                assertEquals(0, count(table));
        }
        var key = UUID.randomUUID();
        status(400, create(owner, key, CREATE.replace("Проверка заявки", "bad\\uD800value")));
        var accepted = create(owner, key, CREATE.replace("Проверка заявки", "Название 😀"));
        status(201, accepted);
        var id = UUID.fromString(body(accepted).get("taskId").asString());
        for (String escape : List.of("\\uD800", "\\uDC00")) {
            var rejected =
                    mvc.perform(
                                    patch("/api/tasks/" + id)
                                            .session(owner.session())
                                            .header("X-CSRF-TOKEN", owner.csrf())
                                            .header("Idempotency-Key", UUID.randomUUID())
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(
                                                    "{\"title\":\"bad"
                                                            + escape
                                                            + "value\",\"expectedTitleRevision\":1}"))
                            .andReturn();
            status(400, rejected);
            assertEquals("VALIDATION_FAILED", body(rejected).get("code").asString());
        }
        assertEquals("Название 😀", jdbc.queryForObject("SELECT title FROM tasks WHERE id=?", String.class, id));
        assertEquals(1, count("task_history"));
        assertEquals(1, count("command_receipts"));
        status(200, rename(owner, id, UUID.randomUUID(), "Новое 𐀀", 1));
        assertEquals("Новое 𐀀", jdbc.queryForObject("SELECT title FROM tasks WHERE id=?", String.class, id));
    }

    @Test
    void malformedUnicodeCannotAliasAnAlreadyCommittedRenameReceipt() throws Exception {
        var owner = login("initiator.one");
        var id = created(owner, UUID.randomUUID());
        var key = UUID.randomUUID();
        var saved = rename(owner, id, key, "before?after", 1);
        status(200, saved);
        for (String escape : List.of("\\uD800", "\\uDC00")) {
            var invalid =
                    mvc.perform(
                                    patch("/api/tasks/" + id)
                                            .session(owner.session())
                                            .header("X-CSRF-TOKEN", owner.csrf())
                                            .header("Idempotency-Key", key)
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(
                                                    "{\"title\":\"before"
                                                            + escape
                                                            + "after\",\"expectedTitleRevision\":1}"))
                            .andReturn();
            status(400, invalid);
            assertEquals("VALIDATION_FAILED", body(invalid).get("code").asString());
        }
        var replay = rename(owner, id, key, "before?after", 1);
        status(200, replay);
        assertEquals(body(saved), body(replay));
        status(409, rename(owner, id, key, "before#after", 1));
        assertEquals(2, count("command_receipts"));
        assertEquals(2, count("task_history"));
        assertEquals("before?after", jdbc.queryForObject("SELECT title FROM tasks WHERE id=?", String.class, id));
        status(200, rename(owner, id, UUID.randomUUID(), "Допустимый Unicode 😀", 2));
    }

    @Test
    void utcFiltersRejectUnsupportedCalendarYearsBeforeJdbc() throws Exception {
        var owner = login("initiator.one");
        created(owner, UUID.randomUUID());
        for (String field : List.of("createdFrom", "createdTo")) {
            for (String invalid :
                    List.of("0000-01-01T00:00:00Z", "+10000-01-01T00:00:00Z", "+999999999-01-01T00:00:00Z")) {
                var response =
                        mvc.perform(get("/api/tasks").session(owner.session()).param(field, invalid)).andReturn();
                status(400, response);
                assertEquals("VALIDATION_FAILED", body(response).get("code").asString());
            }
        }
        var full =
                mvc.perform(
                                get("/api/tasks")
                                        .session(owner.session())
                                        .param("createdFrom", "0001-01-01T00:00:00Z")
                                        .param("createdTo", "9999-12-31T23:59:59Z"))
                        .andReturn();
        status(200, full);
        assertEquals(1, body(full).get("totalItems").asInt());
        assertEquals(1, count("tasks"));
        assertEquals(1, count("task_history"));
        assertEquals(1, count("command_receipts"));
    }
}
