package com.azhukov.integration.tasks;

import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.support.PostgresTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ExchangeWorkflowTest extends PostgresTest {
    @Autowired ExchangeTasks exchange;
    @Autowired PlatformTransactionManager transactions;

    @Test
    void ambiguityUsesGetAndTheSameAttemptCounter() throws Exception {
        var owner = login("initiator.one");
        UUID id = created(owner,UUID.randomUUID());
        var claim = exchange.claim();
        assertEquals("PUT",claim.step());
        exchange.finish(claim,new ExchangeReply(503,null,false));
        assertEquals("UNKNOWN",delivery(id));
        assertEquals(1,count("exchange_issues"));
        dueNow();
        var check = exchange.claim();
        assertEquals("GET",check.step());
        assertEquals(2,check.number());
        exchange.finish(check,new ExchangeReply(404,json.readTree("{\"title\":\"Отсутствует\",\"status\":404,\"code\":\"OPERATION_NOT_FOUND\"}"),false));
        assertEquals("RETRY_WAIT",delivery(id));
        dueNow();
        var repeat = exchange.claim();
        assertEquals(claim.operationId(),repeat.operationId());
        assertEquals(claim.request(),repeat.request());
        assertEquals("PUT",repeat.step());
        assertEquals(3,repeat.number());
    }

    @Test
    void expiredLeaseIsCountedAndCannotApplyALateResponse() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var old = exchange.claim();
        jdbc.update("UPDATE delivery_queue SET claimed_until = clock_timestamp() - interval '3 seconds'");
        assertNull(exchange.claim());
        assertEquals("UNKNOWN",delivery(id));
        assertEquals("INTERRUPTED",jdbc.queryForObject("SELECT outcome FROM delivery_attempts WHERE id = ?",String.class,old.attemptId()));
        exchange.finish(old,new ExchangeReply(202,ack(old),false));
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
        assertTrue(exchange.consume(0,page(1,result(claim,2,"SUCCEEDED"))));
        assertEquals("ACKNOWLEDGED",delivery(id));
        assertEquals("SUCCEEDED",business(id));
        exchange.finish(claim,new ExchangeReply(503,null,false));
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
        exchange.consume(0,page(1,finalResult));
        long history = count("task_history");
        exchange.consume(1,page(2,finalResult));
        assertEquals(history,count("task_history"));
        exchange.consume(2,page(3,result(claim,1,"RUNNING")));
        assertEquals("SUCCEEDED",business(id));
        var conflict = result(claim,2,"REJECTED");
        exchange.consume(3,page(4,conflict));
        assertEquals(1,count("exchange_issues"));
        jdbc.update("UPDATE exchange_issues SET status = 'RESOLVED'");
        exchange.consume(4,page(5,conflict));
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
        exchange.consume(0,page(1,wrong));
        assertEquals("QUEUED",delivery(id));
        assertEquals("PENDING",business(id));
        assertEquals(1,count("exchange_issues"));
        exchange.finish(claim,new ExchangeReply(409,json.readTree("{\"code\":\"OPERATION_CONFLICT\"}"),false));
        assertEquals("NEEDS_REVIEW",delivery(id));
    }

    @Test
    void pausedAndStoppedObserveBothRunningAndFinalWithoutApplying() throws Exception {
        UUID id = created(login("initiator.one"),UUID.randomUUID());
        var claim = exchange.claim();
        exchange.finish(claim,new ExchangeReply(400,null,false));
        for (int version : new int[]{1,2}) {
            var incoming = result(claim,version,version == 1 ? "RUNNING" : "SUCCEEDED");
            long after = exchange.cursor();
            exchange.consume(after,page(after + 1,incoming));
            long issues = count("exchange_issues");
            exchange.consume(after + 1,page(after + 2,incoming));
            assertEquals(issues,count("exchange_issues"));
        }
        assertEquals("NEEDS_REVIEW",delivery(id));
        assertEquals("PENDING",business(id));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE observed_result IS NOT NULL",Integer.class));
        jdbc.update("UPDATE tasks SET delivery_status = 'STOPPED' WHERE id = ?",id);
        for (int version : new int[]{1,2}) {
            var incoming = result(claim,version,version == 1 ? "RUNNING" : "SUCCEEDED");
            long after = exchange.cursor();
            exchange.consume(after,page(after + 1,incoming));
            int issues = count("exchange_issues");
            exchange.consume(after + 1,page(after + 2,incoming));
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
            exchange.consume(0,page(1,result(claim,2,"SUCCEEDED")));
            status.setRollbackOnly();
        });
        assertEquals(0,exchange.cursor());
        assertEquals("PENDING",business(id));
        assertTrue(exchange.consume(0,page(1,result(claim,2,"SUCCEEDED"))));
        assertFalse(exchange.consume(0,page(1,result(claim,2,"REJECTED"))));
        assertEquals("SUCCEEDED",business(id));
    }

    @Test
    void auditLogsOnlyCommittedChangesAndContainsNoCredentials() throws Exception {
        var owner=login("initiator.one");
        var logger=(ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger(TaskRepository.class);
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

    private tools.jackson.databind.JsonNode page(long cursor, tools.jackson.databind.JsonNode result) {
        return json.createArrayNode().add(json.createObjectNode().put("cursor",cursor).set("result",result));
    }
    private tools.jackson.databind.JsonNode result(ExchangeTasks.Claim claim,int version,String status) {
        var result = json.createObjectNode().put("operationId",claim.operationId().toString())
            .set("request",json.valueToTree(claim.request())).put("version",version).put("status",status);
        if (version == 2) result.put("completedAt","2026-11-12T00:00:00Z");
        if (status.equals("REJECTED")) result.put("rejectionCode","QUANTITY_LIMIT_EXCEEDED");
        return result;
    }
    private tools.jackson.databind.JsonNode ack(ExchangeTasks.Claim claim) {
        return json.createObjectNode().put("operationId",claim.operationId().toString())
            .set("request",json.valueToTree(claim.request())).put("acceptedAt","2026-11-12T00:00:00Z");
    }
    private String delivery(UUID id) { return jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?",String.class,id); }
    private String business(UUID id) { return jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?",String.class,id); }
    private void dueNow() { jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() - interval '1 second'"); }
}
