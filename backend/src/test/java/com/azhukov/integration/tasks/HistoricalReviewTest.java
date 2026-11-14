package com.azhukov.integration.tasks;

import static com.azhukov.integration.support.ExchangeTestData.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.azhukov.integration.client.ExternalExchangeClient.Lookup;
import com.azhukov.integration.client.http.HttpExternalExchangeClient;
import com.azhukov.integration.domain.review.Reconciliation.Availability;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

class HistoricalReviewTest extends PostgresTest {
    @MockitoBean HttpExternalExchangeClient client;
    @Autowired ExchangeService exchange;

    @Test
    void historicalIssueReceiptKeepsItsOldOwnerAndDoesNotRewriteCurrentIssue() throws Exception {
        var task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        finish(exchange, claim, new com.azhukov.integration.client.http.ExchangeReply(400, null, false, null));
        UUID issue = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id=?", UUID.class, task);
        UUID key = UUID.randomUUID();
        String historical =
                """
                {"issueId":"%s","taskId":"%s","operationId":"%s","issueRevision":2,
                 "kind":"PROTOCOL_ERROR","status":"OPEN","openedAt":"2026-11-12T00:00:00Z",
                 "summary":"Ошибка протокола","assignedTo":"%s","evidence":{},"allowedActions":["RECONCILE"]}
                """
                        .formatted(issue, task, claim.operationId(), operator);
        String canonical = "{\"id\":\"" + issue + "\",\"input\":{\"expectedIssueRevision\":1}}";
        receipt("TAKE_ISSUE", key, canonical, historical);
        long history = count("task_history");
        var op = login("operator");
        var replay =
                mvc.perform(
                                post("/api/exchange/issues/" + issue + "/take")
                                        .session(op.session())
                                        .header("X-CSRF-TOKEN", op.csrf())
                                        .header("Idempotency-Key", key)
                                        .contentType("application/json")
                                        .content("{\"expectedIssueRevision\":1}"))
                        .andReturn();
        status(200, replay);
        assertEquals(json.readTree(historical), body(replay));
        assertNull(jdbc.queryForObject("SELECT assigned_to FROM exchange_issues WHERE id=?", UUID.class, issue));
        assertEquals(history, count("task_history"));
        verifyNoInteractions(client);
    }

    @Test
    void historicalReconciliationIsReadableAndItsReceiptReplaysWithoutAuditWrites() throws Exception {
        var task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        UUID id = UUID.randomUUID(), key = UUID.randomUUID();
        String historical =
                """
                {"reconciliationId":"%s","taskId":"%s","operationId":"%s","checkedAt":"2026-11-12T00:00:00.123456789Z",
                 "checkedBy":"%s","outcome":"MATCH","local":{"request":{"reference":"REQ-000001","quantity":25},
                 "deliveryStatus":"QUEUED","businessStatus":"PENDING"},"externalAvailability":"NOT_FOUND"}
                """
                        .formatted(id, task, claim.operationId(), operator);
        jdbc.update(
                "INSERT INTO reconciliations(id,task_id,exchange_version,checked_at,checked_by,snapshot) VALUES (?,?,1,clock_timestamp(),?,?::jsonb)",
                id,
                task,
                operator,
                historical);
        receipt("RECONCILE", key, "\"" + task + "\"", historical);
        long history = count("task_history");
        var op = login("operator");
        var read = mvc.perform(get("/api/tasks/" + task + "/reconciliations/" + id).session(op.session())).andReturn();
        status(200, read);
        assertEquals(json.readTree(historical), body(read));
        when(client.lookup(claim.operationId())).thenReturn(new Lookup(Availability.UNAVAILABLE, null, null, null));
        var replay =
                mvc.perform(
                                post("/api/tasks/" + task + "/reconciliations")
                                        .session(op.session())
                                        .header("X-CSRF-TOKEN", op.csrf())
                                        .header("Idempotency-Key", key))
                        .andReturn();
        status(200, replay);
        assertEquals(json.readTree(historical), body(replay));
        assertEquals(history, count("task_history"));
        assertEquals(1, count("reconciliations"));
        status(
                403,
                mvc.perform(
                                get("/api/tasks/" + task + "/reconciliations/" + id)
                                        .session(login("initiator.one").session()))
                        .andReturn());
    }

    private void receipt(String command, UUID key, String canonical, String historical) throws Exception {
        String fingerprint =
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        jdbc.update(
                "INSERT INTO command_receipts(actor_id,command_type,idempotency_key,fingerprint,http_status,response_body) VALUES (?,?,?,?,200,?::jsonb)",
                operator,
                command,
                key,
                fingerprint,
                historical);
    }
}
