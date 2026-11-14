package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.repository.ReviewRepository;
import com.azhukov.integration.support.PostgresTest;
import java.util.HashSet;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PaginationWorkflowTest extends PostgresTest {
    @Autowired ReviewRepository issues;

    @Test
    void taskPagesUseSizeWithoutChangingOwnershipOrTheDefault() throws Exception {
        var owner = login("initiator.one");
        for (int i = 0; i < 25; i++) created(owner, UUID.randomUUID());
        var original = mvc.perform(get("/api/tasks").session(owner.session())).andReturn();
        status(200, original);
        assertEquals(20, body(original).get("items").size());
        assertEquals(2, body(original).get("totalPages").asInt());
        var ids = new HashSet<String>();
        for (int page = 0; page < 4; page++) {
            var result =
                    mvc.perform(get("/api/tasks").session(owner.session()).param("page", "" + page).param("size", "7"))
                            .andReturn();
            status(200, result);
            var rows = body(result).get("items");
            assertEquals(page == 3 ? 4 : 7, rows.size());
            assertEquals(25, body(result).get("totalItems").asInt());
            assertEquals(4, body(result).get("totalPages").asInt());
            assertEquals(page < 3, body(result).get("hasNext").asBoolean());
            for (int i = 0; i < rows.size(); i++) assertTrue(ids.add(rows.get(i).get("taskId").asString()));
        }
        assertEquals(25, ids.size());
        var other = login("initiator.two");
        var hidden = mvc.perform(get("/api/tasks").session(other.session()).param("size", "100")).andReturn();
        status(200, hidden);
        assertEquals(0, body(hidden).get("totalItems").asInt());
        for (String size : new String[] {"0", "-1", "101", "no-number"})
            status(400, mvc.perform(get("/api/tasks").session(owner.session()).param("size", size)).andReturn());
    }

    @Test
    void everyCollectionUsesTheSameInt32PageBoundary() throws Exception {
        var owner = login("initiator.one");
        var task = created(owner, UUID.randomUUID());
        var operator = login("operator");
        for (String path : new String[] {"/api/tasks", "/api/tasks/" + task + "/history", "/api/exchange/issues"}) {
            for (String invalid : new String[] {"-1", "0.5", "2147483648", "9007199254740991"})
                status(400, mvc.perform(get(path).session(operator.session()).param("page", invalid)).andReturn());
            var last = mvc.perform(get(path).session(operator.session()).param("page", "2147483647")).andReturn();
            status(200, last);
            assertEquals(2147483647, body(last).get("page").asInt());
            assertTrue(body(last).get("items").isEmpty());
            assertFalse(body(last).get("hasNext").asBoolean());
        }
        status(403, mvc.perform(get("/api/exchange/issues").session(owner.session()).param("page", "1")).andReturn());
    }

    @Test
    void historySizePreservesAllEventsAndAccessChecks() throws Exception {
        var owner = login("initiator.one");
        var id = created(owner, UUID.randomUUID());
        for (int revision = 1; revision <= 10; revision++)
            status(200, rename(owner, id, UUID.randomUUID(), "Версия " + revision, revision));
        var ids = new HashSet<String>();
        for (int page = 0; page < 4; page++) {
            var result =
                    mvc.perform(
                                    get("/api/tasks/" + id + "/history")
                                            .session(owner.session())
                                            .param("page", "" + page)
                                            .param("size", "3"))
                            .andReturn();
            status(200, result);
            var rows = body(result).get("items");
            assertEquals(page == 3 ? 2 : 3, rows.size());
            assertEquals(11, body(result).get("totalItems").asInt());
            assertEquals(4, body(result).get("totalPages").asInt());
            for (int i = 0; i < rows.size(); i++) assertTrue(ids.add(rows.get(i).get("eventId").asString()));
        }
        assertEquals(11, ids.size());
        status(
                404,
                mvc.perform(
                                get("/api/tasks/" + id + "/history")
                                        .session(login("initiator.two").session())
                                        .param("size", "100"))
                        .andReturn());
        status(
                200,
                mvc.perform(
                                get("/api/tasks/" + id + "/history")
                                        .session(login("operator").session())
                                        .param("size", "100"))
                        .andReturn());
        for (String size : new String[] {"0", "101"})
            status(
                    400,
                    mvc.perform(get("/api/tasks/" + id + "/history").session(owner.session()).param("size", size))
                            .andReturn());
    }

    @Test
    void issuePagesUseSizeAndKeepOperatorOnlyAccess() throws Exception {
        for (int i = 0; i < 7; i++)
            issues.open(
                    null,
                    null,
                    Issue.Kind.PROTOCOL_ERROR,
                    "Проверка " + i,
                    i,
                    new Evidence("Тестовая запись", null, null, null));
        var operator = login("operator");
        var ids = new HashSet<String>();
        for (int page = 0; page < 4; page++) {
            var result =
                    mvc.perform(
                                    get("/api/exchange/issues")
                                            .session(operator.session())
                                            .param("page", "" + page)
                                            .param("size", "2")
                                            .param("status", "OPEN"))
                            .andReturn();
            status(200, result);
            var rows = body(result).get("items");
            assertEquals(page == 3 ? 1 : 2, rows.size());
            assertEquals(7, body(result).get("totalItems").asInt());
            assertEquals(4, body(result).get("totalPages").asInt());
            for (int i = 0; i < rows.size(); i++) assertTrue(ids.add(rows.get(i).get("issueId").asString()));
        }
        assertEquals(7, ids.size());
        status(
                403,
                mvc.perform(get("/api/exchange/issues").session(login("initiator.one").session()).param("size", "2"))
                        .andReturn());
        for (String size : new String[] {"0", "101"})
            status(
                    400,
                    mvc.perform(get("/api/exchange/issues").session(operator.session()).param("size", size))
                            .andReturn());
    }
}
