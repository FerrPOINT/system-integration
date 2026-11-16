package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.azhukov.integration.support.PostgresTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class UnicodeCommandTest extends PostgresTest {
    @Test
    void generatedValidationAndDomainAgreeOnTitleLengthWhitespaceAndReplay() throws Exception {
        var owner = login("initiator.one");
        String title = "😀".repeat(160);
        var input = Map.of("title", title, "request", Map.of("reference", "REQ-000001", "quantity", 25));
        var key = UUID.randomUUID();
        var created = create(owner, key, json.writeValueAsString(input));
        status(201, created);
        assertEquals(
                title,
                jdbc.queryForObject(
                        "SELECT title FROM tasks WHERE id=?",
                        String.class,
                        UUID.fromString(body(created).get("taskId").asString())));
        assertEquals(body(created), body(create(owner, key, json.writeValueAsString(input))));
        for (String invalid : new String[] {"😀".repeat(161), "\uFEFF", "\u0085", " \u0085\uFEFF"}) {
            var bad = Map.of("title", invalid, "request", input.get("request"));
            status(400, create(owner, UUID.randomUUID(), json.writeValueAsString(bad)));
        }
        var neighbor = Map.of("title", "X\uFEFF", "request", input.get("request"));
        status(201, create(owner, UUID.randomUUID(), json.writeValueAsString(neighbor)));
        assertEquals(2, count("tasks"));
        assertEquals(2, count("command_receipts"));
    }

    @Test
    void generatedReasonValidationAgreesWithTheCommandBeforeIssueLookup() throws Exception {
        var op = login("operator");
        for (String reason : new String[] {"😀".repeat(500), "X\uFEFF", "X\u0085"}) status(404, resolve(op, reason));
        for (String reason : new String[] {"😀".repeat(501), "\uFEFF", "\u0085", "\u0000"})
            status(400, resolve(op, reason));
        assertEquals(0, count("command_receipts"));
    }

    private org.springframework.test.web.servlet.MvcResult resolve(Client op, String reason) throws Exception {
        return mvc.perform(
                        post("/api/exchange/issues/" + UUID.randomUUID() + "/resolve")
                                .session(op.session())
                                .header("X-CSRF-TOKEN", op.csrf())
                                .header("Idempotency-Key", UUID.randomUUID())
                                .contentType("application/json")
                                .content(
                                        json.writeValueAsString(
                                                Map.of(
                                                        "expectedIssueRevision",
                                                        1,
                                                        "action",
                                                        "ACKNOWLEDGE_FEED_ISSUE",
                                                        "reason",
                                                        reason))))
                .andReturn();
    }
}
