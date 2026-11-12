package com.azhukov.integration.tasks;

import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.exchange.ExchangeClient;
import com.azhukov.integration.support.PostgresTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class OperationsWorkflowTest extends PostgresTest {
    @MockitoBean ExchangeClient client;
    @Autowired ExchangeTasks exchange;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean JdbcTemplate observedSql;

    @Test
    void countedIssuePagesRespectTheStatusFilter() throws Exception {
        difference();
        var op=login("operator");
        var open=mvc.perform(get("/api/exchange/issues").param("status","OPEN").session(op.session())).andReturn();
        status(200,open);
        assertEquals(1,body(open).get("totalItems").asLong());
        assertEquals(1,body(open).get("totalPages").asLong());
        var empty=mvc.perform(get("/api/exchange/issues").param("status","RESOLVED").session(op.session())).andReturn();
        assertEquals(0,body(empty).get("totalItems").asLong());
        assertEquals(0,body(empty).get("totalPages").asLong());
        var beyond=mvc.perform(get("/api/exchange/issues").param("status","OPEN").param("page","999").session(op.session())).andReturn();
        assertEquals(0,body(beyond).get("items").size());
        assertEquals(1,body(beyond).get("totalItems").asLong());
    }

    @Test
    void issuePageUsesBoundedSqlAndKeepsTheSameActionsAsEachCard() throws Exception {
        var scenario=difference();
        var op=scenario.op();
        clearInvocations(observedSql);
        var one=mvc.perform(get("/api/exchange/issues").session(op.session())).andReturn();
        status(200,one);
        long oneRowReads=selectCalls();

        var initiator=login("initiator.two");
        for (int n=0;n<18;n++) {
            created(initiator,UUID.randomUUID());
            var claim=exchange.claim();
            assertNotNull(claim);
            exchange.finish(claim,new ExchangeReply(400,null,false));
        }
        jdbc.update("""
            INSERT INTO exchange_issues(id,scope,fingerprint,kind,summary,evidence)
            VALUES (?,'feed','list-test','RESULT_CONFLICT','Проблема ленты','{}')
            """,UUID.randomUUID());
        clearInvocations(observedSql);
        var page=mvc.perform(get("/api/exchange/issues").session(op.session())).andReturn();
        status(200,page);
        long twentyRowReads=selectCalls();
        assertEquals(oneRowReads,twentyRowReads,"SQL count must not grow with the page size");
        assertTrue(twentyRowReads<=10,"A page needs only issue/count/task/reconciliation reads");
        assertEquals(20,body(page).get("items").size());
        for (var row:body(page).get("items")) {
            var card=issue(op,UUID.fromString(row.get("issueId").asString()));
            status(200,card);
            assertEquals(body(card),row,"List and card must expose the same evidence and actions");
        }
        var empty=mvc.perform(get("/api/exchange/issues").param("page","1").session(op.session())).andReturn();
        status(200,empty);
        assertTrue(body(empty).get("items").isEmpty());
        assertEquals(20,body(empty).get("totalItems").asLong());
        status(403,mvc.perform(get("/api/exchange/issues").session(initiator.session())).andReturn());
    }

    private long selectCalls() {
        return mockingDetails(observedSql).getInvocations().stream()
            .filter(call -> call.getMethod().getName().equals("query") && call.getArguments().length>0 &&
                call.getArguments()[0] instanceof String sql && sql.stripLeading().startsWith("SELECT"))
            .count();
    }

    @Test
    void comparisonIsOutsideTheTransactionAndOldSnapshotsRemainReadable() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        var op=login("operator");
        when(client.get(claim.operationId())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return missing();
        });
        var first=reconcile(op,task,UUID.randomUUID()); status(200,first);
        var saved=body(first);
        assertEquals("MATCH",saved.get("outcome").asString());
        assertEquals("NOT_FOUND",saved.get("externalAvailability").asString());
        when(client.get(claim.operationId())).thenReturn(new ExchangeReply(503,null,false));
        var unavailable=reconcile(op,task,UUID.randomUUID()); status(200,unavailable);
        assertEquals("UNAVAILABLE",body(unavailable).get("outcome").asString());
        assertEquals("PENDING",jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?",String.class,task));
        var read=mvc.perform(get("/api/tasks/"+task+"/reconciliations/"+saved.get("reconciliationId").asString()).session(op.session())).andReturn();
        status(200,read); assertEquals(saved,body(read));
        assertThrows(DataAccessException.class,() -> jdbc.update("UPDATE reconciliations SET snapshot = '{}'"));
        status(403,mvc.perform(get("/api/tasks/"+task+"/reconciliations/"+saved.get("reconciliationId").asString())
            .session(login("initiator.one").session())).andReturn());
    }

    @Test
    void responsibilityTransferAndReplayedReceiptDoNotRewriteCurrentOwner() throws Exception {
        var scenario=difference();
        var firstKey=UUID.randomUUID();
        var first=command(scenario.op(),"take",scenario.issue(),firstKey,Map.of("expectedIssueRevision",scenario.revision()));
        status(200,first);
        long revision=body(first).get("issueRevision").asLong();
        UUID secondOperator=UUID.randomUUID();
        jdbc.update("INSERT INTO users VALUES (?,?,?,?)",secondOperator,"operator.two",passwords.encode(PASSWORD),"OPERATOR");
        var other=login("operator.two");
        var moved=command(other,"take",scenario.issue(),UUID.randomUUID(),Map.of("expectedIssueRevision",revision));
        status(200,moved);
        assertEquals(secondOperator.toString(),body(moved).get("assignedTo").asString());
        var replay=command(scenario.op(),"take",scenario.issue(),firstKey,Map.of("expectedIssueRevision",scenario.revision()));
        status(200,replay); assertEquals(body(first),body(replay));
        var current=issue(other,scenario.issue());
        assertEquals(secondOperator.toString(),body(current).get("assignedTo").asString());
        status(409,command(scenario.op(),"take",scenario.issue(),UUID.randomUUID(),Map.of("expectedIssueRevision",revision)));
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type = 'RESPONSIBILITY_CHANGED'",Integer.class));
        var transferred=jdbc.queryForMap("SELECT actor_user_id,details::text FROM task_history WHERE event_type = 'RESPONSIBILITY_CHANGED' AND actor_user_id = ?",secondOperator);
        var details=json.readTree((String)transferred.get("details"));
        assertEquals(operator.toString(),details.get("previousAssigneeId").asString());
        assertEquals(secondOperator.toString(),details.get("assignedTo").asString());
    }

    @Test
    void applyExternalResultIsAtomicAndTheFeedDuplicateHasNoEffect() throws Exception {
        var scenario=difference();
        var key=UUID.randomUUID();
        var input=Map.of("expectedIssueRevision",scenario.revision(),"reconciliationId",scenario.reconciliation(),
            "action","APPLY_EXTERNAL_RESULT","reason","Проверено независимое состояние исполнителя");
        var decision=command(scenario.op(),"resolve",scenario.issue(),key,input); status(200,decision);
        var history=count("task_history");
        var replay=command(scenario.op(),"resolve",scenario.issue(),key,input); status(200,replay);
        assertEquals(body(decision),body(replay)); assertEquals(history,count("task_history"));
        assertEquals("SUCCEEDED",jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?",String.class,scenario.task()));
        var event=json.createObjectNode().put("cursor",1).set("result",external(scenario.claim(),true,25).body().get("result"));
        exchange.consume(0,json.createArrayNode().add(event));
        assertEquals(history,count("task_history"));
        var saved=mvc.perform(get("/api/tasks/"+scenario.task()+"/reconciliations/"+scenario.reconciliation()).session(scenario.op().session())).andReturn();
        status(200,saved); assertEquals("PENDING",body(saved).at("/local/businessStatus").asString());
        assertEquals(operator.toString(),body(decision).get("decidedBy").asString());
        assertEquals("RESOLVED",body(issue(scenario.op(),scenario.issue())).get("status").asString());
    }

    @Test
    void staleComparisonCannotAuthorizeADecisionButFreshMatchCanCloseIt() throws Exception {
        var scenario=difference();
        var result=external(scenario.claim(),true,25).body().get("result");
        exchange.consume(0,json.createArrayNode().add(json.createObjectNode().put("cursor",1).set("result",result)));
        var oldDecision=command(scenario.op(),"resolve",scenario.issue(),UUID.randomUUID(),Map.of(
            "expectedIssueRevision",scenario.revision(),"reconciliationId",scenario.reconciliation(),"action","ACKNOWLEDGE_DIFFERENCE","reason","Сверено"));
        status(409,oldDecision); assertEquals("SNAPSHOT_STALE",body(oldDecision).get("code").asString());
        var fresh=reconcile(scenario.op(),scenario.task(),UUID.randomUUID()); status(200,fresh);
        assertEquals("MATCH",body(fresh).get("outcome").asString());
        var current=body(issue(scenario.op(),scenario.issue()));
        var input=Map.of("expectedIssueRevision",current.get("issueRevision").asLong(),"reconciliationId",body(fresh).get("reconciliationId").asString(),
            "action","ACKNOWLEDGE_DIFFERENCE","reason","Итог получен через ленту, расхождение устранено");
        status(200,command(scenario.op(),"resolve",scenario.issue(),UUID.randomUUID(),input));
        UUID otherTask=created(login("initiator.two"),UUID.randomUUID());
        status(404,mvc.perform(get("/api/tasks/"+otherTask+"/reconciliations/"+scenario.reconciliation()).session(scenario.op().session())).andReturn());
    }

    @Test
    void protocolRetryRequiresFreshEvidenceAndPreservesInputAndCounter() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var original=exchange.claim();
        exchange.finish(original,new ExchangeReply(400,null,false));
        var op=login("operator");
        UUID issue=jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id = ?",UUID.class,task);
        when(client.get(original.operationId())).thenReturn(missing());
        var snapshot=reconcile(op,task,UUID.randomUUID()); status(200,snapshot);
        long revision=body(issue(op,issue)).get("issueRevision").asLong();
        var input=Map.of("expectedIssueRevision",revision,"reconciliationId",body(snapshot).get("reconciliationId").asString(),"reason","Источник исправлен");
        var key=UUID.randomUUID();
        var retry=command(op,"retry",issue,key,input); status(200,retry);
        assertEquals("DELIVERY_UNCERTAIN",body(retry).get("kind").asString());
        assertTrue(body(retry).at("/evidence/reason").asString().contains("протокола"));
        status(200,command(op,"retry",issue,key,input));
        var claim=exchange.claim();
        assertEquals("GET",claim.step()); assertEquals(2,claim.number());
        assertEquals(original.operationId(),claim.operationId()); assertEquals(original.request(),claim.request());
        exchange.finish(claim,external(claim,false,25));
        assertEquals("ACKNOWLEDGED",jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?",String.class,task));
        assertEquals("RESOLVED",body(issue(op,issue)).get("status").asString());
    }

    @Test
    void differentExternalRequestCannotAuthorizeRetryOrApplyAndStopPreservesBusinessState() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim(); exchange.finish(claim,new ExchangeReply(409,null,false));
        var op=login("operator");
        when(client.get(claim.operationId())).thenReturn(external(claim,true,26));
        var reconciliation=reconcile(op,task,UUID.randomUUID()); status(200,reconciliation);
        assertEquals(26,body(reconciliation).at("/external/request/quantity").asInt());
        UUID id=UUID.fromString(body(reconciliation).get("issueId").asString());
        var current=body(issue(op,id));
        assertFalse(current.get("allowedActions").toString().contains("APPLY_EXTERNAL_RESULT"));
        assertFalse(current.get("allowedActions").toString().contains("RETRY"));
        var common=Map.of("expectedIssueRevision",current.get("issueRevision").asLong(),
            "reconciliationId",body(reconciliation).get("reconciliationId").asString(),"reason","Внешняя операция содержит другой запрос");
        status(409,command(op,"retry",id,UUID.randomUUID(),common));
        var stop=new java.util.HashMap<String,Object>(common); stop.put("action","ACKNOWLEDGE_DIFFERENCE");
        status(200,command(op,"resolve",id,UUID.randomUUID(),stop));
        assertEquals("STOPPED",jdbc.queryForObject("SELECT delivery_status FROM tasks WHERE id = ?",String.class,task));
        assertEquals("PENDING",jdbc.queryForObject("SELECT business_status FROM tasks WHERE id = ?",String.class,task));
        assertEquals(0,count("delivery_queue"));
    }

    @Test
    void delayedRetryAdvancesTheExistingQueueAndRejectsConcurrentStaleVersion() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        ExchangeTasks.Claim claim=null;
        for (int n=1;n<=4;n++) {
            claim=exchange.claim(); assertEquals(n,claim.number());
            exchange.finish(claim,new ExchangeReply(0,null,true));
            if (n<4) jdbc.update("UPDATE delivery_queue SET due_at = clock_timestamp() - interval '1 second'");
        }
        var op=login("operator");
        UUID id=jdbc.queryForObject("SELECT id FROM exchange_issues WHERE task_id = ?",UUID.class,task);
        var before=body(issue(op,id));
        assertEquals("DELIVERY_DELAYED",before.get("kind").asString());
        var input=Map.of("expectedIssueRevision",before.get("issueRevision").asLong(),"reason","Связь восстановлена");
        status(200,command(op,"retry",id,UUID.randomUUID(),input));
        status(409,command(op,"retry",id,UUID.randomUUID(),input));
        var next=exchange.claim(); assertEquals(5,next.number()); assertEquals(claim.operationId(),next.operationId());
    }

    @Test
    void aLocalExchangeChangeDuringGetRollsBackTheComparison() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        when(client.get(claim.operationId())).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            new TransactionTemplate(transactions).executeWithoutResult(tx -> jdbc.update(
                "UPDATE tasks SET exchange_version = exchange_version + 1 WHERE id = ?",task));
            return missing();
        });
        var response=reconcile(login("operator"),task,UUID.randomUUID()); status(409,response);
        assertEquals("SNAPSHOT_STALE",body(response).get("code").asString());
        assertEquals(0,count("reconciliations"));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM command_receipts WHERE command_type = 'RECONCILE'",Integer.class));
    }

    @Test
    void malformedComparisonIsVisibleAsAProtocolProblemAndCannotApply() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        when(client.get(claim.operationId())).thenReturn(new ExchangeReply(200,json.readTree("{\"bad\":true}"),false));
        var op=login("operator");
        var comparison=reconcile(op,task,UUID.randomUUID()); status(200,comparison);
        assertEquals("UNAVAILABLE",body(comparison).get("outcome").asString());
        var issue=issue(op,UUID.fromString(body(comparison).get("issueId").asString())); status(200,issue);
        assertEquals("PROTOCOL_ERROR",body(issue).get("kind").asString());
        assertTrue(body(issue).get("summary").asString().contains("некорректный"));
        assertFalse(body(issue).get("allowedActions").toString().contains("APPLY_EXTERNAL_RESULT"));
    }

    private record Scenario(UUID task,ExchangeTasks.Claim claim,Client op,UUID issue,long revision,String reconciliation) {}
    private Scenario difference() throws Exception {
        UUID task=created(login("initiator.one"),UUID.randomUUID());
        var claim=exchange.claim();
        var reply=external(claim,false,25);
        exchange.finish(claim,reply);
        when(client.get(claim.operationId())).thenReturn(external(claim,true,25));
        var op=login("operator"); var saved=reconcile(op,task,UUID.randomUUID()); status(200,saved);
        assertEquals("DIFFERENCE",body(saved).get("outcome").asString());
        UUID issue=UUID.fromString(body(saved).get("issueId").asString());
        long revision=body(issue(op,issue)).get("issueRevision").asLong();
        return new Scenario(task,claim,op,issue,revision,body(saved).get("reconciliationId").asString());
    }
    private ExchangeReply external(ExchangeTasks.Claim claim,boolean completed,int quantity) {
        var request=json.valueToTree(new com.azhukov.integration.contract.external.model.OperationInput(claim.request().getReference(),quantity));
        var body=json.createObjectNode().put("operationId",claim.operationId().toString()).set("request",request)
            .put("acceptedAt","2026-11-12T00:00:00Z");
        if (!completed) {
            // PUT expects an acknowledgement; GET expects explicit execution/result fields.
            if (claim.step().equals("GET")) body.put("executions",0).putNull("result");
        } else {
            body.put("executions",1).set("result",json.createObjectNode().put("operationId",claim.operationId().toString())
                .set("request",request).put("version",2).put("status","SUCCEEDED").put("completedAt","2026-11-12T00:00:01Z"));
        }
        return new ExchangeReply(claim.step().equals("PUT") && !completed ? 202 : 200,body,false);
    }
    private ExchangeReply missing() { return new ExchangeReply(404,json.readTree("{\"title\":\"Отсутствует\",\"status\":404,\"code\":\"OPERATION_NOT_FOUND\"}"),false); }
    private MvcResult reconcile(Client op,UUID task,UUID key) throws Exception {
        return mvc.perform(post("/api/tasks/"+task+"/reconciliations").session(op.session()).header("X-CSRF-TOKEN",op.csrf())
            .header("Idempotency-Key",key)).andReturn();
    }
    private MvcResult issue(Client op,UUID id) throws Exception { return mvc.perform(get("/api/exchange/issues/"+id).session(op.session())).andReturn(); }
    private MvcResult command(Client op,String action,UUID issue,UUID key,Object body) throws Exception {
        return mvc.perform(post("/api/exchange/issues/"+issue+"/"+action).session(op.session()).header("X-CSRF-TOKEN",op.csrf())
            .header("Idempotency-Key",key).contentType("application/json").content(json.writeValueAsString(body))).andReturn();
    }
}
