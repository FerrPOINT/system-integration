package com.azhukov.integration.tasks;

import static com.azhukov.integration.support.ExchangeTestData.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.azhukov.integration.client.http.ExchangeReply;
import com.azhukov.integration.client.http.HttpExternalExchangeClient;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

class OperationsWorkflowTest extends PostgresTest {
    @MockitoBean HttpExternalExchangeClient client;
    @Autowired ExchangeService exchange;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean JdbcTemplate observedSql;
    @MockitoSpyBean com.azhukov.integration.repository.jdbc.JdbcReviewRepository observedIssues;
    @Autowired com.azhukov.integration.service.ReviewService reviews;

    @BeforeEach
    void classifyRawLookupReplies() {
        when(client.lookup(any(UUID.class))).thenCallRealMethod();
    }

    @Test
    void countedIssuePagesRespectTheStatusFilter() throws Exception {
        difference();
        var op = login("operator");
        var open = mvc.perform(get("/api/exchange/issues").param("status", "OPEN").session(op.session())).andReturn();
        status(200, open);
        assertEquals(1, body(open).get("totalItems").asLong());
        assertEquals(1, body(open).get("totalPages").asLong());
        var empty =
                mvc.perform(get("/api/exchange/issues").param("status", "RESOLVED").session(op.session())).andReturn();
        assertEquals(0, body(empty).get("totalItems").asLong());
        assertEquals(0, body(empty).get("totalPages").asLong());
        var beyond =
                mvc.perform(
                                get("/api/exchange/issues")
                                        .param("status", "OPEN")
                                        .param("page", "999")
                                        .session(op.session()))
                        .andReturn();
        assertEquals(0, body(beyond).get("items").size());
        assertEquals(1, body(beyond).get("totalItems").asLong());
    }

    @Test
    void issuePageUsesBoundedSqlAndKeepsTheSameActionsAsEachCard() throws Exception {
        var scenario = difference();
        var op = scenario.op();
        clearInvocations(observedSql);
        var one = mvc.perform(get("/api/exchange/issues").session(op.session())).andReturn();
        status(200, one);
        long oneRowReads = selectCalls();

        var initiator = login("initiator.two");
        for (int n = 0; n < 18; n++) {
            created(initiator, UUID.randomUUID());
            var claim = exchange.claim();
            assertNotNull(claim);
            finish(exchange, claim, new ExchangeReply(400, null, false, null));
        }
        jdbc.update(
                """
                INSERT INTO exchange_issues(id,scope,fingerprint,kind,summary,evidence)
                VALUES (?,'feed','list-test','RESULT_CONFLICT','Проблема ленты','{}')
                """,
                UUID.randomUUID());
        clearInvocations(observedSql);
        var page = mvc.perform(get("/api/exchange/issues").session(op.session())).andReturn();
        status(200, page);
        long twentyRowReads = selectCalls();
        assertEquals(oneRowReads, twentyRowReads, "SQL count must not grow with the page size");
        assertTrue(twentyRowReads <= 10, "A page needs only issue/count/task/reconciliation reads");
        assertEquals(20, body(page).get("items").size());
        for (var row : body(page).get("items")) {
            var card = issue(op, UUID.fromString(row.get("issueId").asString()));
            status(200, card);
            assertEquals(body(card), row, "List and card must expose the same evidence and actions");
        }
        var empty = mvc.perform(get("/api/exchange/issues").param("page", "1").session(op.session())).andReturn();
        status(200, empty);
        assertTrue(body(empty).get("items").isEmpty());
        assertEquals(20, body(empty).get("totalItems").asLong());
        status(403, mvc.perform(get("/api/exchange/issues").session(initiator.session())).andReturn());
    }

    private long selectCalls() {
        return mockingDetails(observedSql).getInvocations().stream()
                .filter(call ->
                        call.getMethod().getName().equals("query")
                                && call.getArguments().length > 0
                                && call.getArguments()[0] instanceof String sql
                                && sql.stripLeading().startsWith("SELECT"))
                .count();
    }

    @Test
    void comparisonIsOutsideTheTransactionAndOldSnapshotsRemainReadable() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        var op = login("operator");
        when(client.get(claim.operationId()))
                .thenAnswer(call -> {
                    assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
                    return missing();
                });
        var first = reconcile(op, task, UUID.randomUUID());
        status(200, first);
        var saved = body(first);
        assertEquals("MATCH", saved.get("outcome").asString());
        assertEquals("NOT_FOUND", saved.get("externalAvailability").asString());
        when(client.get(claim.operationId())).thenReturn(new ExchangeReply(503, null, false, null));
        var unavailable = reconcile(op, task, UUID.randomUUID());
        status(200, unavailable);
        assertEquals("UNAVAILABLE", body(unavailable).get("outcome").asString());
        assertEquals(
                "PENDING", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?", String.class, task));
        var read =
                mvc.perform(
                                get("/api/tasks/"
                                                + task
                                                + "/reconciliations/"
                                                + saved.get("reconciliationId").asString())
                                        .session(op.session()))
                        .andReturn();
        status(200, read);
        assertEquals(saved, body(read));
        assertThrows(DataAccessException.class, () -> jdbc.update("UPDATE reconciliations SET snapshot = '{}'"));
        status(
                403,
                mvc.perform(
                                get("/api/tasks/"
                                                + task
                                                + "/reconciliations/"
                                                + saved.get("reconciliationId").asString())
                                        .session(login("initiator.one").session()))
                        .andReturn());
    }

    @Test
    void reconciliationReplayAndKeyConflictDoNotReadExternalState() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        when(client.get(claim.operationId())).thenReturn(missing());
        var op = login("operator");
        var key = UUID.randomUUID();
        var first = reconcile(op, task, key);
        status(200, first);
        long snapshots = count("reconciliations"), history = count("task_history");
        clearInvocations(client);
        doThrow(new AssertionError("Replay must not call the external system")).when(client).get(any(UUID.class));
        var replay = reconcile(op, task, key);
        status(200, replay);
        assertEquals(body(first), body(replay));
        UUID other = created(login("initiator.two"), UUID.randomUUID());
        long beforeConflict = count("task_history");
        var conflict = reconcile(op, other, key);
        status(409, conflict);
        assertEquals("IDEMPOTENCY_CONFLICT", body(conflict).get("code").asString());
        verifyNoInteractions(client);
        assertEquals(snapshots, count("reconciliations"));
        assertEquals(beforeConflict, count("task_history"));
        assertEquals(history + 1, beforeConflict, "Only the independent task creation adds audit");
    }

    @Test
    void responsibilityTransferAndReplayedReceiptDoNotRewriteCurrentOwner() throws Exception {
        var scenario = difference();
        var firstKey = UUID.randomUUID();
        var first =
                command(
                        scenario.op(),
                        "take",
                        scenario.issue(),
                        firstKey,
                        Map.of("expectedIssueRevision", scenario.revision()));
        status(200, first);
        long revision = body(first).get("issueRevision").asLong();
        UUID secondOperator = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO users VALUES (?,?,?,?)",
                secondOperator,
                "operator.two",
                passwords.encode(PASSWORD),
                "OPERATOR");
        var other = login("operator.two");
        var moved =
                command(other, "take", scenario.issue(), UUID.randomUUID(), Map.of("expectedIssueRevision", revision));
        status(200, moved);
        assertEquals(secondOperator.toString(), body(moved).get("assignedTo").asString());
        var replay =
                command(
                        scenario.op(),
                        "take",
                        scenario.issue(),
                        firstKey,
                        Map.of("expectedIssueRevision", scenario.revision()));
        status(200, replay);
        assertEquals(body(first), body(replay));
        var current = issue(other, scenario.issue());
        assertEquals(secondOperator.toString(), body(current).get("assignedTo").asString());
        status(
                409,
                command(
                        scenario.op(),
                        "take",
                        scenario.issue(),
                        UUID.randomUUID(),
                        Map.of("expectedIssueRevision", revision)));
        assertEquals(
                2,
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_history WHERE event_type = 'RESPONSIBILITY_CHANGED'",
                        Integer.class));
        var transferred =
                jdbc.queryForMap(
                        "SELECT actor_user_id,details::text FROM task_history WHERE event_type = 'RESPONSIBILITY_CHANGED' AND actor_user_id = ?",
                        secondOperator);
        var details = json.readTree((String) transferred.get("details"));
        assertEquals(operator.toString(), details.get("previousAssigneeId").asString());
        assertEquals(secondOperator.toString(), details.get("assignedTo").asString());
    }

    @Test
    void unicodeBlankReasonCannotMutateAnIssueButMeaningfulUnicodeTextIsPreserved() throws Exception {
        var scenario = difference();
        var history = count("task_history");
        var receipts = count("command_receipts");
        var revision = scenario.revision();
        for (var reason :
                new String[] {
                    "\u2003", "\u00a0", "\u3000", Character.toString(0), "До" + Character.toString(0) + "после"
                }) {
            status(
                    400,
                    command(
                            scenario.op(),
                            "retry",
                            scenario.issue(),
                            UUID.randomUUID(),
                            Map.of(
                                    "expectedIssueRevision",
                                    revision,
                                    "reconciliationId",
                                    scenario.reconciliation(),
                                    "reason",
                                    reason)));
            status(
                    400,
                    command(
                            scenario.op(),
                            "resolve",
                            scenario.issue(),
                            UUID.randomUUID(),
                            Map.of(
                                    "expectedIssueRevision",
                                    revision,
                                    "reconciliationId",
                                    scenario.reconciliation(),
                                    "action",
                                    "APPLY_EXTERNAL_RESULT",
                                    "reason",
                                    reason)));
        }
        assertEquals(history, count("task_history"));
        assertEquals(receipts, count("command_receipts"));
        for (String escape : new String[] {"\\uD800", "\\uDC00"}) {
            for (String action : new String[] {"retry", "resolve"}) {
                String input =
                        "{\"expectedIssueRevision\":"
                                + revision
                                + ",\"reconciliationId\":\""
                                + scenario.reconciliation()
                                + "\",\"reason\":\"bad"
                                + escape
                                + "value\",\"action\":\"APPLY_EXTERNAL_RESULT\"}";
                if (action.equals("retry")) input = input.replace(",\"action\":\"APPLY_EXTERNAL_RESULT\"", "");
                var rejected =
                        mvc.perform(
                                        post("/api/exchange/issues/" + scenario.issue() + "/" + action)
                                                .session(scenario.op().session())
                                                .header("X-CSRF-TOKEN", scenario.op().csrf())
                                                .header("Idempotency-Key", UUID.randomUUID())
                                                .contentType("application/json")
                                                .content(input))
                                .andReturn();
                status(400, rejected);
                assertEquals("VALIDATION_FAILED", body(rejected).get("code").asString());
            }
        }
        assertEquals(history, count("task_history"));
        assertEquals(receipts, count("command_receipts"));
        assertEquals(revision, body(issue(scenario.op(), scenario.issue())).get("issueRevision").asLong());
        var reason = "Проверено\u2003оператором 😀";
        var decision =
                command(
                        scenario.op(),
                        "resolve",
                        scenario.issue(),
                        UUID.randomUUID(),
                        Map.of(
                                "expectedIssueRevision",
                                revision,
                                "reconciliationId",
                                scenario.reconciliation(),
                                "action",
                                "APPLY_EXTERNAL_RESULT",
                                "reason",
                                reason));
        status(200, decision);
        assertEquals(reason, body(decision).get("reason").asString());
        assertEquals(
                "SUCCEEDED",
                jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?", String.class, scenario.task()));
    }

    @Test
    void applyExternalResultIsAtomicAndTheFeedDuplicateHasNoEffect() throws Exception {
        var scenario = difference();
        var key = UUID.randomUUID();
        var input =
                Map.of(
                        "expectedIssueRevision",
                        scenario.revision(),
                        "reconciliationId",
                        scenario.reconciliation(),
                        "action",
                        "APPLY_EXTERNAL_RESULT",
                        "reason",
                        "Проверено независимое состояние исполнителя");
        var decision = command(scenario.op(), "resolve", scenario.issue(), key, input);
        status(200, decision);
        var history = count("task_history");
        var replay = command(scenario.op(), "resolve", scenario.issue(), key, input);
        status(200, replay);
        assertEquals(body(decision), body(replay));
        assertEquals(history, count("task_history"));
        assertEquals(
                "SUCCEEDED",
                jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?", String.class, scenario.task()));
        var event =
                json.createObjectNode()
                        .put("cursor", 1)
                        .set("result", external(scenario.claim(), true, 25).body().get("result"));
        consume(exchange, 0, json.createArrayNode().add(event));
        assertEquals(history, count("task_history"));
        var saved =
                mvc.perform(
                                get("/api/tasks/" + scenario.task() + "/reconciliations/" + scenario.reconciliation())
                                        .session(scenario.op().session()))
                        .andReturn();
        status(200, saved);
        assertEquals("PENDING", body(saved).at("/local/businessStatus").asString());
        assertEquals(operator.toString(), body(decision).get("decidedBy").asString());
        assertEquals("RESOLVED", body(issue(scenario.op(), scenario.issue())).get("status").asString());
    }

    @Test
    void staleComparisonCannotAuthorizeADecisionButFreshMatchCanCloseIt() throws Exception {
        var scenario = difference();
        var result = external(scenario.claim(), true, 25).body().get("result");
        consume(
                exchange,
                0,
                json.createArrayNode().add(json.createObjectNode().put("cursor", 1).set("result", result)));
        var oldDecision =
                command(
                        scenario.op(),
                        "resolve",
                        scenario.issue(),
                        UUID.randomUUID(),
                        Map.of(
                                "expectedIssueRevision",
                                scenario.revision(),
                                "reconciliationId",
                                scenario.reconciliation(),
                                "action",
                                "ACKNOWLEDGE_DIFFERENCE",
                                "reason",
                                "Сверено"));
        status(409, oldDecision);
        assertEquals("SNAPSHOT_STALE", body(oldDecision).get("code").asString());
        var fresh = reconcile(scenario.op(), scenario.task(), UUID.randomUUID());
        status(200, fresh);
        assertEquals("MATCH", body(fresh).get("outcome").asString());
        var current = body(issue(scenario.op(), scenario.issue()));
        var input =
                Map.of(
                        "expectedIssueRevision",
                        current.get("issueRevision").asLong(),
                        "reconciliationId",
                        body(fresh).get("reconciliationId").asString(),
                        "action",
                        "ACKNOWLEDGE_DIFFERENCE",
                        "reason",
                        "Итог получен через ленту, расхождение устранено");
        status(200, command(scenario.op(), "resolve", scenario.issue(), UUID.randomUUID(), input));
        UUID otherTask = created(login("initiator.two"), UUID.randomUUID());
        status(
                404,
                mvc.perform(
                                get("/api/tasks/" + otherTask + "/reconciliations/" + scenario.reconciliation())
                                        .session(scenario.op().session()))
                        .andReturn());
    }

    @Test
    void protocolRetryRequiresFreshEvidenceAndPreservesInputAndCounter() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var original = exchange.claim();
        finish(exchange, original, new ExchangeReply(400, null, false, null));
        var op = login("operator");
        UUID issue = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id = ?", UUID.class, task);
        when(client.get(original.operationId())).thenReturn(missing());
        var snapshot = reconcile(op, task, UUID.randomUUID());
        status(200, snapshot);
        long revision = body(issue(op, issue)).get("issueRevision").asLong();
        var beforeInvalid = count("task_history");
        var invalid =
                Map.of(
                        "expectedIssueRevision",
                        revision,
                        "reconciliationId",
                        body(snapshot).get("reconciliationId").asString(),
                        "reason",
                        "До" + Character.toString(0) + "после");
        var rejected = command(op, "retry", issue, UUID.randomUUID(), invalid);
        status(400, rejected);
        assertEquals("VALIDATION_FAILED", body(rejected).get("code").asString());
        assertEquals(beforeInvalid, count("task_history"));
        assertEquals(revision, body(issue(op, issue)).get("issueRevision").asLong());
        var input =
                Map.of(
                        "expectedIssueRevision",
                        revision,
                        "reconciliationId",
                        body(snapshot).get("reconciliationId").asString(),
                        "reason",
                        "Источник исправлен");
        var key = UUID.randomUUID();
        var retry = command(op, "retry", issue, key, input);
        status(200, retry);
        assertEquals("DELIVERY_UNCERTAIN", body(retry).get("kind").asString());
        assertTrue(body(retry).at("/evidence/reason").asString().contains("протокола"));
        status(200, command(op, "retry", issue, key, input));
        var claim = exchange.claim();
        assertEquals("GET", claim.step());
        assertEquals(2, claim.number());
        assertEquals(original.operationId(), claim.operationId());
        assertEquals(original.request(), claim.request());
        finish(exchange, claim, external(claim, false, 25));
        assertEquals(
                "ACKNOWLEDGED",
                jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?", String.class, task));
        assertEquals("RESOLVED", body(issue(op, issue)).get("status").asString());
    }

    @Test
    void differentExternalRequestCannotAuthorizeRetryOrApplyAndStopPreservesBusinessState() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        finish(exchange, claim, new ExchangeReply(409, null, false, null));
        var op = login("operator");
        when(client.get(claim.operationId())).thenReturn(external(claim, true, 26));
        var reconciliation = reconcile(op, task, UUID.randomUUID());
        status(200, reconciliation);
        assertEquals(26, body(reconciliation).at("/external/request/quantity").asInt());
        UUID id = UUID.fromString(body(reconciliation).get("issueId").asString());
        var current = body(issue(op, id));
        assertFalse(current.get("allowedActions").toString().contains("APPLY_EXTERNAL_RESULT"));
        assertFalse(current.get("allowedActions").toString().contains("RETRY"));
        var common =
                Map.of(
                        "expectedIssueRevision",
                        current.get("issueRevision").asLong(),
                        "reconciliationId",
                        body(reconciliation).get("reconciliationId").asString(),
                        "reason",
                        "Внешняя операция содержит другой запрос");
        status(409, command(op, "retry", id, UUID.randomUUID(), common));
        var stop = new java.util.HashMap<String, Object>(common);
        stop.put("action", "ACKNOWLEDGE_DIFFERENCE");
        status(200, command(op, "resolve", id, UUID.randomUUID(), stop));
        assertEquals(
                "STOPPED", jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?", String.class, task));
        assertEquals(
                "PENDING", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?", String.class, task));
        assertEquals(0, count("delivery_queue"));
    }

    @Test
    void operatorStartsOneFreshSeriesWhileReplayAndStaleCommandsCannotResetItAgain() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        DeliveryAttempt claim = null;
        for (int n = 1; n <= 5; n++) {
            jdbc.update("UPDATE delivery_queue SET due_at=clock_timestamp()-interval '1 second'");
            claim = exchange.claim();
            assertEquals(n, claim.number());
            finish(exchange, claim, new ExchangeReply(0, null, true, null));
        }
        var op = login("operator");
        UUID id = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id=?", UUID.class, task);
        var before = body(issue(op, id));
        assertEquals("DELIVERY_DELAYED", before.get("kind").asString());
        status(
                409,
                command(
                        op,
                        "retry",
                        id,
                        UUID.randomUUID(),
                        Map.of(
                                "expectedIssueRevision",
                                before.get("issueRevision").asLong(),
                                "reason",
                                "Связь восстановлена")));
        when(client.get(claim.operationId())).thenReturn(missing());
        var saved = reconcile(op, task, UUID.randomUUID());
        status(200, saved);
        var current = body(issue(op, id));
        var input =
                Map.of(
                        "expectedIssueRevision",
                        current.get("issueRevision").asLong(),
                        "reason",
                        "Состояние проверено, разрешаю продолжение",
                        "reconciliationId",
                        body(saved).get("reconciliationId").asString());
        var key = UUID.randomUUID();
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> command(op, "retry", id, key, input));
            var second = pool.submit(() -> command(op, "retry", id, key, input));
            var a = first.get();
            var b = second.get();
            status(200, a);
            status(200, b);
            assertEquals(body(a), body(b));
        }
        assertEquals(0, jdbc.queryForObject("SELECT automatic_attempts FROM delivery_queue", Integer.class));
        assertEquals(5, jdbc.queryForObject("SELECT attempts FROM delivery_queue", Integer.class));
        var next = exchange.claim();
        assertEquals(6, next.number());
        assertEquals(1, next.automaticNumber());
        assertEquals("GET", next.step());
        assertEquals(claim.operationId(), next.operationId());
        status(200, command(op, "retry", id, key, input));
        assertEquals(1, jdbc.queryForObject("SELECT automatic_attempts FROM delivery_queue", Integer.class));
        assertEquals(next.attemptId(), jdbc.queryForObject("SELECT claim_id FROM delivery_queue", UUID.class));
        status(409, command(op, "retry", id, UUID.randomUUID(), input));
        status(403, command(login("initiator.one"), "retry", id, UUID.randomUUID(), input));
        assertEquals(6, jdbc.queryForObject("SELECT attempts FROM delivery_queue", Integer.class));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_history WHERE event_type='RETRY_QUEUED'", Integer.class));
    }

    @Test
    void exhaustedDeliveryCanApplyAFreshCompletedResultOrExplicitlyStop() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        DeliveryAttempt claim = null;
        for (int n = 1; n <= 5; n++) {
            jdbc.update("UPDATE delivery_queue SET due_at=clock_timestamp()-interval '1 second'");
            claim = exchange.claim();
            finish(exchange, claim, new ExchangeReply(503, null, false, null));
        }
        var op = login("operator");
        UUID id = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id=?", UUID.class, task);
        when(client.get(claim.operationId())).thenReturn(external(claim, true, 25));
        var saved = reconcile(op, task, UUID.randomUUID());
        status(200, saved);
        var current = body(issue(op, id));
        assertTrue(current.get("allowedActions").toString().contains("APPLY_EXTERNAL_RESULT"));
        status(
                200,
                command(
                        op,
                        "resolve",
                        id,
                        UUID.randomUUID(),
                        Map.of(
                                "expectedIssueRevision",
                                current.get("issueRevision").asLong(),
                                "reconciliationId",
                                body(saved).get("reconciliationId").asString(),
                                "action",
                                "APPLY_EXTERNAL_RESULT",
                                "reason",
                                "Подтверждён фактический результат")));
        assertEquals(
                "SUCCEEDED", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, task));
        assertEquals(0, count("delivery_queue"));
        assertEquals(5, count("delivery_attempts"));
    }

    @Test
    void exhaustedDeliveryCanBeStoppedWithoutClaimingBusinessSuccess() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        DeliveryAttempt claim = null;
        for (int n = 1; n <= 5; n++) {
            jdbc.update("UPDATE delivery_queue SET due_at=clock_timestamp()-interval '1 second'");
            claim = exchange.claim();
            finish(exchange, claim, new ExchangeReply(503, null, false, null));
        }
        var op = login("operator");
        UUID id = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id=?", UUID.class, task);
        when(client.get(claim.operationId())).thenReturn(missing());
        var saved = reconcile(op, task, UUID.randomUUID());
        status(200, saved);
        var current = body(issue(op, id));
        status(
                200,
                command(
                        op,
                        "resolve",
                        id,
                        UUID.randomUUID(),
                        Map.of(
                                "expectedIssueRevision",
                                current.get("issueRevision").asLong(),
                                "reconciliationId",
                                body(saved).get("reconciliationId").asString(),
                                "action",
                                "ACKNOWLEDGE_DIFFERENCE",
                                "reason",
                                "Передача отменена после проверки")));
        assertEquals(
                "STOPPED", jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id=?", String.class, task));
        assertEquals(
                "PENDING", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, task));
        assertEquals(0, count("delivery_queue"));
        assertNull(exchange.claim());
    }

    @Test
    void concurrentIndependentResumeCommandsHaveOneWinner() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        DeliveryAttempt last = null;
        for (int n = 1; n <= 5; n++) {
            jdbc.update("UPDATE delivery_queue SET due_at=clock_timestamp()-interval '1 second'");
            last = exchange.claim();
            finish(exchange, last, new ExchangeReply(503, null, false, null));
        }
        var op = login("operator");
        UUID id = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id=?", UUID.class, task);
        when(client.get(last.operationId())).thenReturn(missing());
        var saved = reconcile(op, task, UUID.randomUUID());
        status(200, saved);
        var current = body(issue(op, id));
        var input =
                Map.of(
                        "expectedIssueRevision",
                        current.get("issueRevision").asLong(),
                        "reconciliationId",
                        body(saved).get("reconciliationId").asString(),
                        "reason",
                        "Подтверждаю новую серию");
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var a = pool.submit(() -> command(op, "retry", id, UUID.randomUUID(), input));
            var b = pool.submit(() -> command(op, "retry", id, UUID.randomUUID(), input));
            var outcomes = java.util.List.of(a.get().getResponse().getStatus(), b.get().getResponse().getStatus());
            assertEquals(1, outcomes.stream().filter(code -> code == 200).count());
            assertEquals(1, outcomes.stream().filter(code -> code == 409).count());
        }
        assertEquals(5, jdbc.queryForObject("SELECT attempts FROM delivery_queue", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT automatic_attempts FROM delivery_queue", Integer.class));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_history WHERE event_type='RETRY_QUEUED'", Integer.class));
    }

    @Test
    void aLocalExchangeChangeDuringGetRollsBackTheComparison() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        when(client.get(claim.operationId()))
                .thenAnswer(call -> {
                    assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
                    new TransactionTemplate(transactions)
                            .executeWithoutResult(tx ->
                                    jdbc.update(
                                            "UPDATE tasks SET exchange_version = exchange_version + 1 WHERE id = ?",
                                            task));
                    return missing();
                });
        var response = reconcile(login("operator"), task, UUID.randomUUID());
        status(409, response);
        assertEquals("SNAPSHOT_STALE", body(response).get("code").asString());
        assertEquals(0, count("reconciliations"));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM command_receipts WHERE command_type = 'RECONCILE'", Integer.class));
    }

    @Test
    void malformedComparisonIsVisibleAsAProtocolProblemAndCannotApply() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        when(client.get(claim.operationId()))
                .thenReturn(new ExchangeReply(200, json.readTree("{\"bad\":true}"), false, null));
        var op = login("operator");
        var comparison = reconcile(op, task, UUID.randomUUID());
        status(200, comparison);
        assertEquals("UNAVAILABLE", body(comparison).get("outcome").asString());
        var issue = issue(op, UUID.fromString(body(comparison).get("issueId").asString()));
        status(200, issue);
        assertEquals("PROTOCOL_ERROR", body(issue).get("kind").asString());
        assertTrue(body(issue).get("summary").asString().contains("некорректный"));
        assertFalse(body(issue).get("allowedActions").toString().contains("APPLY_EXTERNAL_RESULT"));
    }

    @Test
    void everyOperatorRouteRejectsBothInitiatorsWithoutReadingExternalStateOrWritingAudit() throws Exception {
        var scenario = difference();
        int history = count("task_history"),
                comparisons = count("reconciliations"),
                receipts = count("command_receipts");
        clearInvocations(client);
        for (var actor : java.util.List.of(login("initiator.one"), login("initiator.two"))) {
            for (String path :
                    java.util.List.of(
                            "/api/exchange/issues",
                            "/api/exchange/issues/" + scenario.issue(),
                            "/api/tasks/" + scenario.task() + "/reconciliations/" + scenario.reconciliation()))
                status(403, mvc.perform(get(path).session(actor.session())).andReturn());
            status(403, reconcile(actor, scenario.task(), UUID.randomUUID()));
            status(
                    403,
                    command(
                            actor,
                            "take",
                            scenario.issue(),
                            UUID.randomUUID(),
                            Map.of("expectedIssueRevision", scenario.revision())));
            status(
                    403,
                    command(
                            actor,
                            "retry",
                            scenario.issue(),
                            UUID.randomUUID(),
                            Map.of(
                                    "expectedIssueRevision",
                                    scenario.revision(),
                                    "reconciliationId",
                                    scenario.reconciliation(),
                                    "reason",
                                    "Запрещённая роль")));
            status(
                    403,
                    command(
                            actor,
                            "resolve",
                            scenario.issue(),
                            UUID.randomUUID(),
                            Map.of(
                                    "expectedIssueRevision",
                                    scenario.revision(),
                                    "reconciliationId",
                                    scenario.reconciliation(),
                                    "action",
                                    "ACKNOWLEDGE_DIFFERENCE",
                                    "reason",
                                    "Запрещённая роль")));
        }
        verifyNoInteractions(client);
        assertEquals(history, count("task_history"));
        assertEquals(comparisons, count("reconciliations"));
        assertEquals(receipts, count("command_receipts"));
        status(200, issue(scenario.op(), scenario.issue()));
    }

    @Test
    void simultaneousOperatorsCannotSilentlyOverwriteTheIssueOwner() throws Exception {
        var scenario = difference();
        UUID secondOperator = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO users VALUES (?,?,?,?)",
                secondOperator,
                "operator.two",
                passwords.encode(PASSWORD),
                "OPERATOR");
        var other = login("operator.two");
        var input = Map.of("expectedIssueRevision", scenario.revision());
        java.util.List<MvcResult> results;
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> command(scenario.op(), "take", scenario.issue(), UUID.randomUUID(), input));
            var second = pool.submit(() -> command(other, "take", scenario.issue(), UUID.randomUUID(), input));
            results = java.util.List.of(first.get(), second.get());
        }
        assertEquals(
                java.util.List.of(200, 409), results.stream().map(r -> r.getResponse().getStatus()).sorted().toList());
        MvcResult winner = results.get(0).getResponse().getStatus() == 200 ? results.get(0) : results.get(1);
        MvcResult loser = results.get(0).getResponse().getStatus() == 409 ? results.get(0) : results.get(1);
        assertEquals("ISSUE_REVISION_CONFLICT", body(loser).get("code").asString());
        var current = body(issue(scenario.op(), scenario.issue()));
        assertEquals(body(winner).get("assignedTo"), current.get("assignedTo"));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM task_history WHERE event_type='RESPONSIBILITY_CHANGED'", Integer.class));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT count(*) FROM command_receipts WHERE command_type='TAKE_ISSUE'", Integer.class));
        var event =
                mvc.perform(get("/api/tasks/" + scenario.task() + "/history").session(scenario.op().session()))
                        .andReturn();
        var assignment =
                java.util.stream.StreamSupport.stream(body(event).get("items").spliterator(), false)
                        .filter(row -> row.get("type").asString().equals("RESPONSIBILITY_CHANGED"))
                        .findFirst()
                        .orElseThrow();
        assertEquals(current.get("assignedTo"), assignment.get("assignedTo"));
        assertEquals(current.get("assignedTo"), assignment.get("actorUserId"));
    }

    @Test
    void concurrentComparisonReplaysOneSnapshotWhileAnotherActorHasAnIndependentCommand() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        finish(exchange, claim, external(claim, false, 25));
        when(client.get(claim.operationId())).thenReturn(external(claim, true, 25));
        var op = login("operator");
        UUID key = UUID.randomUUID();
        java.util.List<MvcResult> results;
        try (var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var a = pool.submit(() -> reconcile(op, task, key));
            var b = pool.submit(() -> reconcile(op, task, key));
            var c = pool.submit(() -> reconcile(op, task, key));
            results = java.util.List.of(a.get(), b.get(), c.get());
        }
        for (var response : results) {
            status(200, response);
            assertEquals(body(results.getFirst()), body(response));
        }
        assertEquals(1, count("reconciliations"));
        assertEquals(
                1,
                jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='RECONCILED'", Integer.class));
        UUID otherId = UUID.randomUUID();
        jdbc.update(
                "INSERT INTO users VALUES (?,?,?,?)", otherId, "operator.two", passwords.encode(PASSWORD), "OPERATOR");
        var independent = reconcile(login("operator.two"), task, key);
        status(200, independent);
        assertNotEquals(body(results.getFirst()).get("reconciliationId"), body(independent).get("reconciliationId"));
        assertEquals(otherId.toString(), body(independent).get("checkedBy").asString());
        assertEquals(2, count("reconciliations"));
        var original =
                mvc.perform(
                                get("/api/tasks/"
                                                + task
                                                + "/reconciliations/"
                                                + body(results.getFirst()).get("reconciliationId").asString())
                                        .session(op.session()))
                        .andReturn();
        status(200, original);
        assertEquals(body(results.getFirst()), body(original));
    }

    @Test
    void issueCardKeepsOneSnapshotWhileAnotherOperatorAppliesTheResult() throws Exception {
        var scenario = difference();
        var armed = new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(
                        call -> {
                            var row = call.callRealMethod();
                            if (armed.getAndSet(false)) {
                                java.util.concurrent.CompletableFuture.runAsync(() ->
                                                reviews.resolve(
                                                        new com.azhukov.integration.domain.Actor(
                                                                operator,
                                                                com.azhukov.integration.domain.Actor.Role.OPERATOR),
                                                        UUID.randomUUID(),
                                                        scenario.issue(),
                                                        new com.azhukov.integration.dto.review.IssueCommands.Resolve(
                                                                scenario.revision(),
                                                                UUID.fromString(scenario.reconciliation()),
                                                                com.azhukov.integration.domain.review.IssueResolution
                                                                        .Action.APPLY_EXTERNAL_RESULT,
                                                                "Подтверждено")))
                                        .get(5, java.util.concurrent.TimeUnit.SECONDS);
                            }
                            return row;
                        })
                .when(observedIssues)
                .get(scenario.issue(), false);
        try {
            var card = issue(scenario.op(), scenario.issue());
            status(200, card);
            assertEquals("OPEN", body(card).get("status").asString());
            assertTrue(
                    java.util.stream.StreamSupport.stream(body(card).get("allowedActions").spliterator(), false)
                            .anyMatch(action -> action.asString().equals("APPLY_EXTERNAL_RESULT")),
                    "The old issue and its fresh comparison must describe the same snapshot as the task");
        } finally {
            doCallRealMethod().when(observedIssues).get(scenario.issue(), false);
        }
        var current = issue(scenario.op(), scenario.issue());
        status(200, current);
        assertEquals("RESOLVED", body(current).get("status").asString());
        assertTrue(body(current).get("allowedActions").isEmpty());
        assertEquals(
                "SUCCEEDED",
                jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, scenario.task()));
    }

    private record Scenario(
            UUID task, DeliveryAttempt claim, Client op, UUID issue, long revision, String reconciliation) {}

    private Scenario difference() throws Exception {
        UUID task = created(login("initiator.one"), UUID.randomUUID());
        var claim = exchange.claim();
        var reply = external(claim, false, 25);
        finish(exchange, claim, reply);
        when(client.get(claim.operationId())).thenReturn(external(claim, true, 25));
        var op = login("operator");
        var saved = reconcile(op, task, UUID.randomUUID());
        status(200, saved);
        assertEquals("DIFFERENCE", body(saved).get("outcome").asString());
        UUID issue = UUID.fromString(body(saved).get("issueId").asString());
        long revision = body(issue(op, issue)).get("issueRevision").asLong();
        return new Scenario(task, claim, op, issue, revision, body(saved).get("reconciliationId").asString());
    }

    private ExchangeReply external(DeliveryAttempt claim, boolean completed, int quantity) {
        var request =
                json.valueToTree(
                        new com.azhukov.integration.contract.external.model.OperationInput(
                                claim.request().reference(), quantity));
        var body =
                json.createObjectNode()
                        .put("operationId", claim.operationId().toString())
                        .set("request", request)
                        .put("acceptedAt", "2026-11-12T00:00:00Z");
        if (!completed) {
            // PUT expects an acknowledgement; GET expects explicit execution/result fields.
            if (claim.step().equals("GET")) body.put("executions", 0).putNull("result");
        } else {
            body.put("executions", 1)
                    .set(
                            "result",
                            json.createObjectNode()
                                    .put("operationId", claim.operationId().toString())
                                    .set("request", request)
                                    .put("version", 2)
                                    .put("status", "SUCCEEDED")
                                    .put("completedAt", "2026-11-12T00:00:01Z"));
        }
        return new ExchangeReply(claim.step().equals("PUT") && !completed ? 202 : 200, body, false, null);
    }

    private ExchangeReply missing() {
        return new ExchangeReply(
                404,
                json.readTree("{\"title\":\"Отсутствует\",\"status\":404,\"code\":\"OPERATION_NOT_FOUND\"}"),
                false,
                null);
    }

    private MvcResult reconcile(Client op, UUID task, UUID key) throws Exception {
        return mvc.perform(
                        post("/api/tasks/" + task + "/reconciliations")
                                .session(op.session())
                                .header("X-CSRF-TOKEN", op.csrf())
                                .header("Idempotency-Key", key))
                .andReturn();
    }

    private MvcResult issue(Client op, UUID id) throws Exception {
        return mvc.perform(get("/api/exchange/issues/" + id).session(op.session())).andReturn();
    }

    private MvcResult command(Client op, String action, UUID issue, UUID key, Object body) throws Exception {
        return mvc.perform(
                        post("/api/exchange/issues/" + issue + "/" + action)
                                .session(op.session())
                                .header("X-CSRF-TOKEN", op.csrf())
                                .header("Idempotency-Key", key)
                                .contentType("application/json")
                                .content(json.writeValueAsString(body)))
                .andReturn();
    }

    @Test
    void unsupportedLookupStatusesOpenProtocolIssuesButTemporaryFailureDoesNot() throws Exception {
        var owner = login("initiator.one");
        var op = login("operator");
        for (int code : new int[] {503, 201, 202, 204, 302}) {
            UUID task = created(owner, UUID.randomUUID());
            UUID operation = jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", UUID.class, task);
            when(client.get(operation)).thenReturn(new ExchangeReply(code, null, false, null));
            UUID key = UUID.randomUUID();
            var result = reconcile(op, task, key);
            status(200, result);
            assertEquals("UNAVAILABLE", body(result).get("outcome").asString());
            assertEquals("UNAVAILABLE", body(result).get("externalAvailability").asString());
            var issueId = body(result).get("issueId");
            if (code == 503) {
                assertTrue(issueId == null || issueId.isNull());
                assertEquals(
                        0,
                        jdbc.queryForObject(
                                "SELECT count(*) FROM exchange_issues WHERE task_id=?", Integer.class, task));
            } else {
                assertNotNull(issueId);
                assertFalse(issueId.isNull());
                assertEquals(
                        "PROTOCOL_ERROR",
                        jdbc.queryForObject("SELECT kind FROM exchange_issues WHERE task_id=?", String.class, task));
                assertEquals(
                        1,
                        jdbc.queryForObject(
                                "SELECT count(*) FROM task_history WHERE task_id=? AND event_type='ISSUE_OPENED'",
                                Integer.class,
                                task));
            }
            assertEquals(
                    "PENDING", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, task));
            int history = count("task_history");
            var replay = reconcile(op, task, key);
            status(200, replay);
            assertEquals(body(result), body(replay));
            assertEquals(history, count("task_history"));
            verify(client, times(1)).get(operation);
        }
    }
}
