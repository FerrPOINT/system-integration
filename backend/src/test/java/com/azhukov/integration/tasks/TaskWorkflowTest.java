package com.azhukov.integration.tasks;

import com.azhukov.integration.support.PostgresTest;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class TaskWorkflowTest extends PostgresTest {
    @Test
    void sessionCsrfAndLogoutAreEnforcedAtTheHttpBoundary() throws Exception {
        status(401, mvc.perform(get("/api/session")).andReturn());
        status(401, mvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content(CREATE)).andReturn());
        var anonymous = mvc.perform(get("/api/csrf")).andReturn();
        var session = (MockHttpSession) anonymous.getRequest().getSession();
        String token = body(anonymous).get("token").asString();
        status(401, mvc.perform(post("/api/login").session(session).header("X-CSRF-TOKEN", token)
            .param("username", "initiator.one").param("password", "incorrect")).andReturn());
        var client = login("INITIATOR.ONE");
        status(403, mvc.perform(post("/api/tasks").session(client.session())
            .header("Idempotency-Key", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content(CREATE)).andReturn());
        status(403, mvc.perform(post("/api/logout").session(client.session()).header("X-CSRF-TOKEN", "invalid")).andReturn());
        var identity = mvc.perform(get("/api/session").session(client.session())).andReturn();
        status(200, identity);
        assertEquals(first.toString(), body(identity).get("userId").asString());
        assertFalse(body(identity).has("password"));
        status(204, mvc.perform(post("/api/logout").session(client.session())
            .header("X-CSRF-TOKEN", client.csrf())).andReturn());
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
            results = pool.invokeAll(List.<Callable<MvcResult>>of(() -> create(owner, key, CREATE),
                () -> create(owner, key, CREATE), () -> create(owner, key, CREATE)))
                .stream().map(f -> { try { return f.get(); } catch (Exception e) { throw new RuntimeException(e); } }).toList();
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
            a = one.get(); b = two.get();
        }
        assertEquals(List.of(200,409), List.of(a.getResponse().getStatus(), b.getResponse().getStatus()).stream().sorted().toList());
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
        jdbc.execute("""
            CREATE FUNCTION test_reject_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Test failure before enqueue'; END; $$
            """);
        jdbc.execute("CREATE TRIGGER test_enqueue_failure BEFORE INSERT ON delivery_queue FOR EACH ROW EXECUTE FUNCTION test_reject_enqueue()");
        try {
            assertThrows(Exception.class, () -> create(owner, UUID.randomUUID(), CREATE));
            for (String table : List.of("tasks", "delivery_queue", "command_receipts", "task_history")) assertEquals(0, count(table));
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
        status(405, mvc.perform(post("/api/tasks/" + id + "/history").session(owner.session())
            .header("X-CSRF-TOKEN", owner.csrf()).contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn());
    }

    @Test
    void registryPaginationAndHalfOpenUtcPeriodAreStable() throws Exception {
        var owner = login("initiator.one");
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        for (int i = 0; i < 22; i++) {
            jdbc.update("""
                INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,created_at)
                VALUES (?,?,?,'Проверка','REQ-000001',1,?)
                """, UUID.randomUUID(), first, UUID.randomUUID(), at.plusSeconds(i));
        }
        var result = mvc.perform(get("/api/tasks").session(owner.session())
            .param("createdFrom", at.toString()).param("createdTo", at.plusSeconds(21).toString())).andReturn();
        status(200, result);
        assertEquals(20, body(result).get("items").size());
        assertTrue(body(result).get("hasNext").asBoolean());
        assertEquals(at.plusSeconds(20).toInstant(), OffsetDateTime.parse(body(result).at("/items/0/createdAt").asString()).toInstant());
        var next = mvc.perform(get("/api/tasks").session(owner.session()).param("page", "1")
            .param("createdFrom", at.toString()).param("createdTo", at.plusSeconds(21).toString())).andReturn();
        assertEquals(1, body(next).get("items").size());
        assertFalse(body(next).get("hasNext").asBoolean());
        var filtered = mvc.perform(get("/api/tasks").session(owner.session()).param("businessStatus", "SUCCEEDED")).andReturn();
        assertEquals(0, body(filtered).get("items").size());
        status(400, mvc.perform(get("/api/tasks").session(owner.session()).param("page", "-1")).andReturn());
        status(400, mvc.perform(get("/api/tasks").session(owner.session()).param("createdFrom", at.toString())
            .param("createdTo", at.toString())).andReturn());
    }

    @Test
    void invalidFieldsAndUnknownPropertiesDoNotCreatePartialState() throws Exception {
        var owner = login("initiator.one");
        for (String invalid : List.of(CREATE.replace("25", "0"), CREATE.replace("REQ-000001", "other"),
            CREATE.replace("Проверка заявки", "  "), CREATE.replace("\"title\":", "\"ownerId\":\"" + second + "\",\"title\":"))) {
            status(400, create(owner, UUID.randomUUID(), invalid));
        }
        assertEquals(0, count("tasks"));
    }

}
