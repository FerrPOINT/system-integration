package com.azhukov.integration.tasks;

import com.azhukov.integration.client.http.ExchangeReply;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.repository.jdbc.JdbcTaskRepository;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static com.azhukov.integration.support.ExchangeTestData.*;
import static org.junit.jupiter.api.Assertions.*;

class ExchangeWorkflowTest extends PostgresTest {
    @Autowired ExchangeService exchange;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void claimSkipsFutureWorkAndActiveLeaseWithoutHidingAnotherDueTask() throws Exception {
        var owner = login("initiator.one");
        var future = created(owner, UUID.randomUUID());
        var leased = created(owner, UUID.randomUUID());
        var ready = created(owner, UUID.randomUUID());
        jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() - interval '1 second'");
        jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() + interval '1 hour' WHERE operation_id = (SELECT operation_id FROM tasks WHERE id = ?)", future);
        jdbc.update("UPDATE delivery_queue SET claim_id = ?,claimed_until = clock_timestamp() + interval '1 hour' WHERE operation_id = (SELECT operation_id FROM tasks WHERE id = ?)", UUID.randomUUID(), leased);
        var selected = exchange.claim();
        assertNotNull(selected);
        assertEquals(jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id = ?",UUID.class,ready), selected.operationId());
        assertNull(exchange.claim());
        jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() - interval '1 second' WHERE operation_id = (SELECT operation_id FROM tasks WHERE id = ?)", future);
        var next = exchange.claim();
        assertNotNull(next);
        assertEquals(jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id = ?",UUID.class,future), next.operationId());
        assertNull(exchange.claim());
    }

    @Test
    void ambiguityUsesGetAndTheSameAttemptCounter() throws Exception {
        var owner = login("initiator.one");
        UUID id = created(owner,UUID.randomUUID());
        var claim = exchange.claim();
        assertEquals("PUT",claim.step());
        finish(exchange,claim,new ExchangeReply(503,null,false));
        assertEquals("UNKNOWN",delivery(id));
        assertEquals(1,count("exchange_issues"));
        dueNow();
        var check = exchange.claim();
        assertEquals("GET",check.step());
        assertEquals(2,check.number());
        finish(exchange,check,new ExchangeReply(404,json.readTree("{\"title\":\"Отсутствует\",\"status\":404,\"code\":\"OPERATION_NOT_FOUND\"}"),false));
        assertEquals("RETRY_WAIT",delivery(id));
        dueNow();
        var repeat = exchange.claim();
        assertEquals(claim.operationId(),repeat.operationId());
        assertEquals(claim.request(),repeat.request());
        assertEquals("PUT",repeat.step());
        assertEquals(3,repeat.number());
    }

    @Test
    void automaticSeriesStopsAfterFiveFailuresAndDoesNotHideOtherWork() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        UUID operation=jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id = ?",UUID.class,id);
        for (int n=1;n<=5;n++) {
            dueNow();
            var attempt=exchange.claim();
            assertNotNull(attempt);
            assertEquals(n,attempt.number());
            assertEquals(n,attempt.automaticNumber());
            assertEquals(operation,attempt.operationId());
            assertEquals(n==1 ? "PUT" : "GET",attempt.step());
            finish(exchange,attempt,new ExchangeReply(503,null,false));
            if (n<5) {
                int delay=DeliveryAttempt.delay(n);
                double remaining=jdbc.queryForObject(
                    "SELECT extract(epoch FROM due_at-clock_timestamp()) FROM delivery_queue WHERE operation_id = ?",
                    Double.class,operation);
                assertTrue(remaining>delay-1 && remaining<=delay);
                assertNull(exchange.claim(),"Backoff must not be bypassed");
            }
        }
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals("PENDING",business(id));
        assertEquals("DELIVERY_DELAYED",jdbc.queryForObject("SELECT kind FROM exchange_issues",String.class));
        long history=count("task_history");
        for (int n=0;n<8;n++) { dueNow();assertNull(exchange.claim()); }
        assertEquals(5,count("delivery_attempts"));
        assertEquals(history,count("task_history"));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='DELIVERY_ATTEMPT' AND summary LIKE 'Автоматическая доставка приостановлена:%'",Integer.class));
        var owner=login("initiator.one");
        var historyResponse=mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
            .get("/api/tasks/"+id+"/history").session(owner.session())).andReturn();
        status(200,historyResponse);
        assertTrue(body(historyResponse).get("items").toString().contains("исчерпан лимит 5 попыток"));
        UUID other=created(login("initiator.two"),UUID.randomUUID());
        dueNow();var next=exchange.claim();assertNotNull(next);
        assertEquals(jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?",UUID.class,other),next.operationId());
    }

    @Test
    void successOnLastAttemptStillAcknowledgesAndAppliesItsResult() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        for (int n=1;n<5;n++) {
            dueNow();var attempt=exchange.claim();finish(exchange,attempt,new ExchangeReply(503,null,false));
        }
        dueNow();var last=exchange.claim();assertEquals(5,last.automaticNumber());
        finish(exchange,last,new ExchangeReply(200,ack(last).put("executions",0).putNull("result"),false));
        assertEquals("ACKNOWLEDGED",delivery(id));assertEquals(0,count("delivery_queue"));
        consume(exchange,0,page(1,result(last,2,"SUCCEEDED")));
        assertEquals("SUCCEEDED",business(id));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='DELIVERY_ATTEMPT' AND summary LIKE 'Автоматическая доставка приостановлена:%'",Integer.class));
    }

    @Test
    void interruptedLastClaimPausesWithoutAnExtraGetAndIgnoresItsLateAck() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        for (int n=1;n<5;n++) { dueNow();finish(exchange,exchange.claim(),new ExchangeReply(503,null,false)); }
        dueNow();var last=exchange.claim();
        jdbc.update("UPDATE delivery_queue SET claimed_until=clock_timestamp()-interval '1 second'");
        assertNull(exchange.claim());
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals("INTERRUPTED",jdbc.queryForObject("SELECT outcome FROM delivery_attempts WHERE id=?",String.class,last.attemptId()));
        long pauses=jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='DELIVERY_ATTEMPT' AND summary LIKE 'Автоматическая доставка приостановлена:%'",Long.class);
        for (int n=0;n<4;n++) { dueNow();assertNull(exchange.claim()); }
        finish(exchange,last,new ExchangeReply(200,ack(last).put("executions",0).putNull("result"),false));
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals(5,count("delivery_attempts"));assertEquals(1,pauses);
        assertEquals(pauses,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='DELIVERY_ATTEMPT' AND summary LIKE 'Автоматическая доставка приостановлена:%'",Long.class));
    }

    @Test
    void historicalOverLimitQueueCannotAcquireAnotherNetworkAttempt() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        jdbc.update("UPDATE delivery_queue SET attempts=208,automatic_attempts=208");
        assertNull(exchange.claim());
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals(0,count("delivery_attempts"));
        assertEquals(208,jdbc.queryForObject("SELECT attempts FROM delivery_queue",Integer.class));
        assertEquals(208,jdbc.queryForObject("SELECT automatic_attempts FROM delivery_queue",Integer.class));
    }

    @Test
    void lateResultAfterExhaustionRemainsAnObservationForOperatorReview() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        DeliveryAttempt last=null;
        for (int n=1;n<=5;n++) { dueNow();last=exchange.claim();finish(exchange,last,new ExchangeReply(503,null,false)); }
        consume(exchange,0,page(1,result(last,2,"SUCCEEDED")));
        assertEquals("NEEDS_REVIEW",delivery(id));assertEquals("PENDING",business(id));
        assertEquals(1,exchange.cursor());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='RESULT_APPLIED'",Integer.class));
        assertEquals(1,count("delivery_queue"));
    }

    @Test
    void failedPauseAuditRollsBackStateAndTheExpiredClaimStillCannotSendASixthAttempt() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        for (int n=1;n<5;n++) { dueNow();finish(exchange,exchange.claim(),new ExchangeReply(503,null,false)); }
        dueNow();var last=exchange.claim();
        jdbc.execute("ALTER TABLE task_history ADD CONSTRAINT si10_reject_pause CHECK (summary NOT LIKE 'Автоматическая доставка приостановлена:%')");
        try {
            assertThrows(org.springframework.dao.DataAccessException.class,() -> finish(exchange,last,new ExchangeReply(503,null,false)));
        } finally { jdbc.execute("ALTER TABLE task_history DROP CONSTRAINT si10_reject_pause"); }
        assertEquals("UNKNOWN",delivery(id));
        assertEquals(last.attemptId(),jdbc.queryForObject("SELECT claim_id FROM delivery_queue",UUID.class));
        assertNull(jdbc.queryForObject("SELECT outcome FROM delivery_attempts WHERE id=?",String.class,last.attemptId()));
        assertEquals("DELIVERY_UNCERTAIN",jdbc.queryForObject("SELECT kind FROM exchange_issues",String.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='DELIVERY_ATTEMPT' AND summary LIKE 'Автоматическая доставка приостановлена:%'",Integer.class));
        jdbc.update("UPDATE delivery_queue SET claimed_until=clock_timestamp()-interval '1 second'");
        assertNull(exchange.claim());assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals(5,count("delivery_attempts"));
    }

    @Test
    void expiredLeaseIsCountedAndCannotApplyALateResponse() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var old = exchange.claim();
        jdbc.update("UPDATE delivery_queue SET claimed_until = clock_timestamp() - interval '3 seconds'");
        assertNull(exchange.claim());
        assertEquals("UNKNOWN",delivery(id));
        assertEquals("INTERRUPTED",jdbc.queryForObject("SELECT outcome FROM delivery_attempts WHERE id = ?",String.class,old.attemptId()));
        finish(exchange,old,new ExchangeReply(202,ack(old),false));
        assertEquals("UNKNOWN",delivery(id));
        dueNow();
        var next = exchange.claim();
        assertEquals(2,next.number());
        assertEquals("GET",next.step());
    }

    @Test
    void earlyResultConfirmsDeliveryAndLateHttpFailureCannotRollItBack() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        assertTrue(consume(exchange,0,page(1,result(claim,2,"SUCCEEDED"))));
        assertEquals("ACKNOWLEDGED",delivery(id));
        assertEquals("SUCCEEDED",business(id));
        finish(exchange,claim,new ExchangeReply(503,null,false));
        assertEquals("ACKNOWLEDGED",delivery(id));
        assertEquals(0,count("delivery_queue"));
        assertEquals(0,count("exchange_issues"));
        assertEquals(1,exchange.cursor());
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE summary = 'Поздний исход попытки не изменил состояние'",Integer.class));
    }

    @Test
    void duplicateLateAndConflictingResultsHaveDifferentEffects() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        var finalResult = result(claim,2,"SUCCEEDED");
        consume(exchange,0,page(1,finalResult));
        long history = count("task_history");
        consume(exchange,1,page(2,finalResult));
        assertEquals(history,count("task_history"));
        consume(exchange,2,page(3,result(claim,1,"RUNNING")));
        assertEquals("SUCCEEDED",business(id));
        var conflict = result(claim,2,"REJECTED");
        consume(exchange,3,page(4,conflict));
        assertEquals(1,count("exchange_issues"));
        jdbc.update("UPDATE exchange_issues SET status = 'RESOLVED'");
        consume(exchange,4,page(5,conflict));
        assertEquals(1,count("exchange_issues"));
        assertEquals("SUCCEEDED",business(id));
        assertEquals(5,exchange.cursor());
    }

    @Test
    void wrongImmutableInputCannotConfirmDeliveryBeforePut() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        var wrong = result(claim,2,"SUCCEEDED").deepCopy();
        ((tools.jackson.databind.node.ObjectNode)wrong.get("request")).put("quantity",26);
        consume(exchange,0,page(1,wrong));
        assertEquals("QUEUED",delivery(id));
        assertEquals("PENDING",business(id));
        assertEquals(1,count("exchange_issues"));
        finish(exchange,claim,new ExchangeReply(409,json.readTree("{\"code\":\"OPERATION_CONFLICT\"}"),false));
        assertEquals("NEEDS_REVIEW",delivery(id));
    }

    @Test
    void pausedAndStoppedObserveBothRunningAndFinalWithoutApplying() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        finish(exchange,claim,new ExchangeReply(400,null,false));
        for (int version : new int[]{1,2}) {
            var incoming = result(claim,version,version == 1 ? "RUNNING" : "SUCCEEDED");
            long after = exchange.cursor();
            consume(exchange,after,page(after + 1,incoming));
            long issues = count("exchange_issues");
            consume(exchange,after + 1,page(after + 2,incoming));
            assertEquals(issues,count("exchange_issues"));
        }
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals("PENDING",business(id));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE observed_result IS NOT NULL",Integer.class));
        jdbc.update("UPDATE tasks SET delivery_status = 'STOPPED' WHERE id = ?",id);
        for (int version : new int[]{1,2}) {
            var incoming = result(claim,version,version == 1 ? "RUNNING" : "SUCCEEDED");
            long after = exchange.cursor();
            consume(exchange,after,page(after + 1,incoming));
            int issues = count("exchange_issues");
            consume(exchange,after + 1,page(after + 2,incoming));
            assertEquals(issues,count("exchange_issues"));
        }
        assertEquals("STOPPED",delivery(id));
        assertEquals("PENDING",business(id));
    }

    @Test
    void cursorAndResultRollbackTogetherAndAnOldConsumerCannotReapply() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        var transaction = new TransactionTemplate(transactions);
        transaction.executeWithoutResult(status -> {
            consume(exchange,0,page(1,result(claim,2,"SUCCEEDED")));
            status.setRollbackOnly();
        });
        assertEquals(0,exchange.cursor());
        assertEquals("PENDING",business(id));
        assertTrue(consume(exchange,0,page(1,result(claim,2,"SUCCEEDED"))));
        assertFalse(consume(exchange,0,page(1,result(claim,2,"REJECTED"))));
        assertEquals("SUCCEEDED",business(id));
    }

    @Test
    void auditLogsOnlyCommittedChangesAndContainsNoCredentials() throws Exception {
        var owner=login("initiator.one");
        var logger=(ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(JdbcTaskRepository.class);
        var appender=new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        appender.start(); logger.addAppender(appender);
        try {
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                try { created(owner,UUID.randomUUID()); } catch (Exception error) { throw new RuntimeException(error); }
                tx.setRollbackOnly();
            });
            assertTrue(appender.list.isEmpty());
            var task=created(owner,UUID.randomUUID());
            assertEquals(1,appender.list.size());
            String line=appender.list.getFirst().getFormattedMessage();
            assertTrue(line.contains("taskId="+task)); assertTrue(line.contains("type=CREATED"));
            assertFalse(line.contains(PASSWORD)); assertFalse(line.contains(owner.csrf()));
        } finally { logger.detachAppender(appender); appender.stop(); }
    }

    @Test
    void onePageKeepsItsUpdatedStateForDuplicateLateAndConflictingEvents() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        var page=json.createArrayNode();
        var running=result(claim,1,"RUNNING");
        var terminal=result(claim,2,"SUCCEEDED");
        for (var item:java.util.List.of(running,terminal,terminal,running,result(claim,2,"REJECTED")))
            page.add(json.createObjectNode().put("cursor",page.size()+1).set("result",item));
        assertTrue(consume(exchange,0,page));
        assertEquals("SUCCEEDED",business(id));
        assertEquals("ACKNOWLEDGED",delivery(id));
        assertEquals(3,jdbc.queryForObject("SELECT exchange_version FROM tasks WHERE id=?",Long.class,id));
        assertEquals(1,jdbc.queryForObject("SELECT title_revision FROM tasks WHERE id=?",Long.class,id));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='RESULT_APPLIED'",Integer.class));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='RESULT_IGNORED'",Integer.class));
        assertEquals(1,count("exchange_issues"));
        assertEquals(5,exchange.cursor());
    }

    @Test
    void onePagePreservesDiagnosticAssociationForInvalidAndUnknownResults() throws Exception {
        UUID id=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        var invalid=(tools.jackson.databind.node.ObjectNode)result(claim,1,"RUNNING");
        invalid.put("version",3);
        var unknown=(tools.jackson.databind.node.ObjectNode)result(claim,2,"SUCCEEDED");
        unknown.put("operationId",UUID.randomUUID().toString());
        var page=json.createArrayNode();
        for (var item:java.util.List.of(invalid,unknown,result(claim,2,"SUCCEEDED")))
            page.add(json.createObjectNode().put("cursor",page.size()+1).set("result",item));
        assertTrue(consume(exchange,0,page));
        assertEquals("SUCCEEDED",business(id));
        assertEquals(3,exchange.cursor());
        assertEquals(2,count("exchange_issues"));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM exchange_issues WHERE task_id=?",Integer.class,id));
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM exchange_issues WHERE task_id IS NULL",Integer.class));
    }

    private tools.jackson.databind.JsonNode page(long cursor, tools.jackson.databind.JsonNode result) {
        return json.createArrayNode().add(json.createObjectNode().put("cursor",cursor).set("result",result));
    }
    private tools.jackson.databind.JsonNode result(DeliveryAttempt claim,int version,String status) {
        var result = json.createObjectNode().put("operationId",claim.operationId().toString())
            .set("request",json.valueToTree(claim.request())).put("version",version).put("status",status);
        if (version == 2) result.put("completedAt","2026-11-12T00:00:00Z");
        if (status.equals("REJECTED")) result.put("rejectionCode","QUANTITY_LIMIT_EXCEEDED");
        return result;
    }
    private tools.jackson.databind.node.ObjectNode ack(DeliveryAttempt claim) {
        return json.createObjectNode().put("operationId",claim.operationId().toString())
            .set("request",json.valueToTree(claim.request())).put("acceptedAt","2026-11-12T00:00:00Z");
    }
    private String delivery(UUID id) { return jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?",String.class,id); }
    private String business(UUID id) { return jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?",String.class,id); }
    private void dueNow() { jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() - interval '1 second'"); }
}
