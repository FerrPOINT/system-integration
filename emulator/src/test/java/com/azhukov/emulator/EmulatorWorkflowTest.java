package com.azhukov.emulator;

import com.azhukov.emulator.domain.*;
import com.azhukov.emulator.repository.jdbc.JdbcOperationRepository;
import com.azhukov.emulator.service.OperationService;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
@Tag("postgres")
@SpringBootTest(properties = {"si.emulator.worker.enabled=false", "spring.profiles.active=test-faults"})
@AutoConfigureMockMvc
class EmulatorWorkflowTest {
    @Autowired OperationService service;
    @Autowired JdbcOperationRepository operations;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean JdbcTemplate publicationSql;

    @Test
    void lifecycleLogsDescribeCommittedEffectsOnly(org.springframework.boot.test.system.CapturedOutput output) {
        var id=UUID.randomUUID();var request=new OperationRequest("REQ-123456",25);
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            service.accept(id,request);
            assertFalse(output.getAll().contains("event=accepted operationId="+id));
            tx.setRollbackOnly();
        });
        assertFalse(output.getAll().contains("event=accepted operationId="+id));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM operations",Integer.class));
        service.accept(id,request);
        assertTrue(output.getAll().contains("event=accepted operationId="+id));
        service.accept(id,request);
        assertTrue(output.getAll().contains("event=replayed operationId="+id));
        assertTrue(service.executeNext());
        assertTrue(output.getAll().contains("event=executed operationId="+id));
        assertEquals(2,service.publish(25));
        assertTrue(output.getAll().contains("event=published operationId=null detail=count=2"));
        assertEquals(1,service.get(id).executions());
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url",() -> "jdbc:postgresql://127.0.0.1:19632/si_emulator_test");
        properties.add("spring.datasource.username",() -> "si_emulator_test");
        properties.add("spring.datasource.password",() -> System.getenv("SI_EMULATOR_TEST_DB_PASSWORD"));
    }

    @BeforeEach
    void clean() {
        assertEquals("si_emulator_test",jdbc.queryForObject("SELECT current_database()",String.class));
        jdbc.execute("TRUNCATE result_events,faults,operations CASCADE");
        jdbc.update("UPDATE feed_position SET last_cursor = 0 WHERE id = 1");
    }

    @Test
    void batchCounterAndAllCursorAssignmentsRollbackTogether() {
        service.accept(UUID.randomUUID(),new OperationRequest("REQ-000008",25));
        assertTrue(service.executeNext());
        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            assertEquals(2,service.publish(25));
            tx.setRollbackOnly();
        });
        assertEquals(0,jdbc.queryForObject("SELECT last_cursor FROM feed_position WHERE id=1",Long.class));
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM result_events WHERE cursor IS NOT NULL",Integer.class));
        assertEquals(2,service.publish(25));
        assertEquals(java.util.List.of(1L,2L),operations.events(0,100).stream().map(ResultEvent::cursor).toList());
    }

    @Test
    void concurrentPublishersExposeNoHigherCursorBeforeTheFirstBatchCommits() throws Exception {
        for (int n=0;n<25;n++) service.accept(UUID.randomUUID(),new OperationRequest("REQ-000009",25));
        while (service.executeNext()) {}
        var selected=new CountDownLatch(1);
        var release=new CountDownLatch(1);
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var first=pool.submit(() -> new TransactionTemplate(transactions).execute(tx -> {
                int count=service.publish(25);
                selected.countDown();
                try { assertTrue(release.await(5,TimeUnit.SECONDS)); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
                return count;
            }));
            try {
                assertTrue(selected.await(2,TimeUnit.SECONDS));
                var second=pool.submit(() -> service.publish(25));
                awaitBlockedTransaction();
                assertTrue(operations.events(0,100).isEmpty(),"Uncommitted cursors must not be visible");
                release.countDown();
                assertEquals(25,first.get(5,TimeUnit.SECONDS));
                assertEquals(25,second.get(5,TimeUnit.SECONDS));
            } finally { release.countDown(); }
        }
        assertEquals(java.util.stream.LongStream.rangeClosed(1,50).boxed().toList(),
            operations.events(0,100).stream().map(ResultEvent::cursor).toList());
    }

    @Test
    void initialBatchDoesNotPullLateRunningIntoADeadlockWithConcurrentFaultRelease() throws Exception {
        UUID id=UUID.randomUUID();
        var input=new OperationRequest("REQ-000010",25);
        service.configure(input.reference(),FaultMode.DELAY_RESULT);
        service.accept(id,input);
        assertTrue(service.executeNext());
        var selected=new CountDownLatch(1);
        var release=new CountDownLatch(1);
        var firstBatch=new AtomicBoolean(true);
        doAnswer(call -> {
            if (firstBatch.compareAndSet(true,false)) {
                selected.countDown();
                assertTrue(release.await(5,TimeUnit.SECONDS));
            }
            return call.callRealMethod();
        }).when(publicationSql).batchUpdate(startsWith("UPDATE result_events SET cursor"),org.mockito.ArgumentMatchers.<Object[]>anyList());
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var publishing=pool.submit(() -> service.publish(2));
            try {
                assertTrue(selected.await(2,TimeUnit.SECONDS));
                var clearing=pool.submit(() -> service.clear(input.reference()));
                awaitBlockedTransaction();
                release.countDown();
                assertEquals(1,publishing.get(5,TimeUnit.SECONDS),"Only the initially eligible terminal belongs to this batch");
                clearing.get(5,TimeUnit.SECONDS);
            } finally { release.countDown(); }
        }
        assertEquals(1,service.publish(2));
        assertEquals(java.util.List.of(2,1),operations.events(0,100).stream().map(e -> e.result().version()).toList());
    }

    private void awaitBlockedTransaction() throws InterruptedException {
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
        do {
            int blocked=jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0",Integer.class);
            if (blocked>0) return;
            Thread.sleep(10);
        } while (System.nanoTime()<until);
        fail("The controlled competing transaction did not reach its database lock");
    }

    @Test
    void missingCursorUsesTheSameProblemContractAsInvalidValues() throws Exception {
        for (String path:java.util.List.of("/result-events","/result-events?after=-1","/result-events?after=0&limit=101")) {
            var response=mvc.perform(get(path)).andReturn().getResponse();
            assertEquals(400,response.getStatus());
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertEquals("VALIDATION_FAILED",json.readTree(response.getContentAsString()).get("code").asString());
        }
        assertEquals(200,mvc.perform(get("/result-events?after=0&limit=100")).andReturn().getResponse().getStatus());
    }

    @Test
    void exhaustedPoolIsUnavailableAndTheSameReadRecoversAfterConnectionsReturn() throws Exception {
        var pool=jdbc.getDataSource().unwrap(com.zaxxer.hikari.HikariDataSource.class);
        var held=new java.util.ArrayList<java.sql.Connection>();
        try {
            for (int n=0;n<pool.getMaximumPoolSize();n++) held.add(pool.getConnection());
            var response=mvc.perform(get("/result-events?after=0")).andReturn().getResponse();
            assertEquals(503,response.getStatus());
            assertTrue(response.getContentType().startsWith("application/problem+json"));
            assertEquals("UNAVAILABLE",json.readTree(response.getContentAsString()).get("code").asString());
            assertFalse(response.getContentAsString().contains("JDBC"));
        } finally {
            for (var connection:held) connection.close();
        }
        assertEquals(200,mvc.perform(get("/result-events?after=0")).andReturn().getResponse().getStatus());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM operations",Integer.class));
    }

    @Test
    void invalidQuantityTypesCannotBecomeAnAcceptedOperation() throws Exception {
        for (String quantity : java.util.List.of("25.5", "\"25\"", "null", "0", "1001")) {
            var response = mvc.perform(put("/operations/" + UUID.randomUUID()).contentType("application/json")
                .content("{\"reference\":\"REQ-000001\",\"quantity\":" + quantity + "}")).andReturn();
            assertEquals(400, response.getResponse().getStatus());
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM operations", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM result_events", Integer.class));
    }

    @Test
    void httpAcceptReplayConflictAndIndependentState() throws Exception {
        var id = UUID.randomUUID();
        var body = "{\"reference\":\"REQ-000001\",\"quantity\":25}";
        var first = mvc.perform(put("/operations/"+id).contentType("application/json").content(body)).andReturn();
        assertEquals(202,first.getResponse().getStatus());
        var repeat = mvc.perform(put("/operations/"+id).contentType("application/json").content(body)).andReturn();
        assertEquals(200,repeat.getResponse().getStatus());
        assertEquals(json.readTree(first.getResponse().getContentAsString()),json.readTree(repeat.getResponse().getContentAsString()));
        var state = mvc.perform(get("/operations/"+id)).andReturn();
        var accepted = json.readTree(state.getResponse().getContentAsString());
        assertEquals(0,accepted.get("executions").asInt());
        assertTrue(accepted.get("result").isNull());
        var conflict = mvc.perform(put("/operations/"+id).contentType("application/json").content(body.replace("25","26"))).andReturn();
        assertEquals(409,conflict.getResponse().getStatus());
        assertEquals("OPERATION_CONFLICT",json.readTree(conflict.getResponse().getContentAsString()).get("code").asString());
        assertTrue(service.executeNext());
        var completed = operations.get(id);
        assertEquals(1,completed.executions());
        assertEquals("SUCCEEDED",json.valueToTree(completed).at("/result/status").asString());
        var completedWire=mvc.perform(get("/operations/"+id)).andReturn();
        assertEquals(200,completedWire.getResponse().getStatus());
        assertEquals(json.valueToTree(completed),json.readTree(completedWire.getResponse().getContentAsString()));
        assertFalse(service.executeNext());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM result_events",Integer.class));
    }

    @Test
    void concurrentPutsAndWorkersProduceOneExecution() throws Exception {
        UUID id = UUID.randomUUID();
        var input = new OperationRequest("REQ-000002",150);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> service.accept(id,input));
            var second = pool.submit(() -> service.accept(id,input));
            assertNotEquals(first.get().created(),second.get().created());
            var executeOne = pool.submit(() -> service.executeNext());
            var executeTwo = pool.submit(() -> service.executeNext());
            assertNotEquals(executeOne.get(),executeTwo.get());
        }
        var result = operations.get(id);
        assertEquals(1,result.executions());
        var snapshot = json.valueToTree(result);
        assertEquals("REJECTED",snapshot.at("/result/status").asString());
        assertEquals("QUANTITY_LIMIT_EXCEEDED",snapshot.at("/result/rejectionCode").asString());
        service.accept(id,input);
        assertEquals(snapshot,json.valueToTree(operations.get(id)));
    }

    @Test
    void unavailableIsBeforeWriteAndClearingItPreservesTheOperation() {
        var id = UUID.randomUUID();
        var input = new OperationRequest("REQ-000003",25);
        service.configure(input.reference(),FaultMode.UNAVAILABLE);
        assertEquals(RuleViolation.Code.UNAVAILABLE,assertThrows(RuleViolation.class,() -> service.accept(id,input)).code());
        assertEquals(RuleViolation.Code.OPERATION_NOT_FOUND,assertThrows(RuleViolation.class,() -> operations.get(id)).code());
        service.clear(input.reference());
        assertTrue(service.accept(id,input).created());
        service.clear(input.reference());
        assertNotNull(operations.get(id));
    }

    @Test
    void faultHttpErrorsKeepTheirCodesAndBoundConfigurationIsImmutable() throws Exception {
        UUID absent=UUID.randomUUID();
        var notFound=mvc.perform(get("/operations/"+absent)).andReturn();
        assertEquals(404,notFound.getResponse().getStatus());
        assertEquals("OPERATION_NOT_FOUND",json.readTree(notFound.getResponse().getContentAsString()).get("code").asString());
        var fault="/test/faults/REQ-000007";
        assertEquals(204,mvc.perform(put(fault).contentType("application/json").content("{\"mode\":\"UNAVAILABLE\"}")).andReturn().getResponse().getStatus());
        var unavailable=mvc.perform(put("/operations/"+absent).contentType("application/json")
            .content("{\"reference\":\"REQ-000007\",\"quantity\":25}")).andReturn();
        assertEquals(503,unavailable.getResponse().getStatus());
        assertEquals("UNAVAILABLE",json.readTree(unavailable.getResponse().getContentAsString()).get("code").asString());
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM operations",Integer.class));
        assertEquals(204,mvc.perform(delete(fault)).andReturn().getResponse().getStatus());
        assertEquals(204,mvc.perform(put(fault).contentType("application/json").content("{\"mode\":\"DUPLICATE_RESULT\"}")).andReturn().getResponse().getStatus());
        service.accept(absent,new OperationRequest("REQ-000007",25));
        assertEquals(204,mvc.perform(put(fault).contentType("application/json").content("{\"mode\":\"DUPLICATE_RESULT\"}")).andReturn().getResponse().getStatus());
        var conflict=mvc.perform(put(fault).contentType("application/json").content("{\"mode\":\"DELAY_RESULT\"}")).andReturn();
        assertEquals(409,conflict.getResponse().getStatus());
        assertEquals("FAULT_ALREADY_BOUND",json.readTree(conflict.getResponse().getContentAsString()).get("code").asString());
        assertEquals("DUPLICATE_RESULT",jdbc.queryForObject("SELECT mode FROM faults WHERE reference='REQ-000007'",String.class));
    }

    @Test
    void droppedResponseHasCommittedResultAndHeldEventsUntilExplicitRelease() {
        var id = UUID.randomUUID();
        var input = new OperationRequest("REQ-000004",25);
        service.configure(input.reference(),FaultMode.DROP_RESPONSE_AFTER_EXECUTION);
        assertTrue(service.accept(id,input).dropResponse());
        var before = json.valueToTree(operations.get(id));
        assertEquals(1,before.get("executions").asInt());
        assertFalse(service.publish(1)>0);
        assertEquals(0,operations.events(0,100).size());
        assertFalse(service.accept(id,input).dropResponse());
        assertEquals(before,json.valueToTree(operations.get(id)));
        service.clear(input.reference());
        while (service.publish(1)>0) { }
        assertEquals(2,operations.events(0,100).size());
    }

    @Test
    void duplicateAndLateModesPublishDifferentCursorsWithoutReexecution() throws Exception {
        var duplicate = new OperationRequest("REQ-000005",25);
        var late = new OperationRequest("REQ-000006",25);
        service.configure(duplicate.reference(),FaultMode.DUPLICATE_RESULT);
        service.configure(late.reference(),FaultMode.DELAY_RESULT);
        UUID duplicateId = UUID.randomUUID(), lateId = UUID.randomUUID();
        service.accept(duplicateId,duplicate); service.accept(lateId,late);
        while (service.executeNext()) { }
        assertEquals(4,service.publish(25),"Both duplicate terminal copies belong to the initial batch");
        assertEquals(1,service.publish(25),"The newly eligible late RUNNING belongs to the next batch");
        assertEquals(0,service.publish(25));
        var events = operations.events(0,100);
        assertEquals(5,events.size());
        var duplicates = events.stream().filter(e -> e.result().operationId().equals(duplicateId) && e.result().version() == 2).toList();
        assertEquals(2,duplicates.size());
        assertEquals(duplicates.get(0).result(),duplicates.get(1).result());
        assertNotEquals(duplicates.get(0).cursor(),duplicates.get(1).cursor());
        var delayed = events.stream().filter(e -> e.result().operationId().equals(lateId)).toList();
        assertEquals(2,delayed.get(0).result().version());
        assertEquals(1,delayed.get(1).result().version());
        assertEquals(1,operations.get(lateId).executions());
        var wire=mvc.perform(get("/result-events").param("after","0").param("limit","100")).andReturn();
        assertEquals(200,wire.getResponse().getStatus());
        // Compare actual JSON; tree conversion keeps long cursors as LongNode while parsing uses IntNode.
        assertEquals(json.readTree(json.writeValueAsString(events)),json.readTree(wire.getResponse().getContentAsString()));
    }
}
