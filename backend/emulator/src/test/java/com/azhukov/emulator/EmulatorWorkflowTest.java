package com.azhukov.emulator;

import com.azhukov.integration.contract.external.model.OperationInput;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Tag("postgres")
@SpringBootTest(properties = {"si.emulator.worker.enabled=false", "spring.profiles.active=test-faults"})
@AutoConfigureMockMvc
class EmulatorWorkflowTest {
    @Autowired OperationService service;
    @Autowired OperationRepository operations;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url",() -> "jdbc:postgresql://127.0.0.1:19532/si_emulator_test");
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
        assertEquals(1,completed.getExecutions().getValue());
        assertEquals("SUCCEEDED",json.valueToTree(completed).at("/result/status").asString());
        assertFalse(service.executeNext());
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM result_events",Integer.class));
    }

    @Test
    void concurrentPutsAndWorkersProduceOneExecution() throws Exception {
        UUID id = UUID.randomUUID();
        var input = new OperationInput("REQ-000002",150);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> service.accept(id,input));
            var second = pool.submit(() -> service.accept(id,input));
            assertNotEquals(first.get().created(),second.get().created());
            var executeOne = pool.submit(() -> service.executeNext());
            var executeTwo = pool.submit(() -> service.executeNext());
            assertNotEquals(executeOne.get(),executeTwo.get());
        }
        var result = operations.get(id);
        assertEquals(1,result.getExecutions().getValue());
        var snapshot = json.valueToTree(result);
        assertEquals("REJECTED",snapshot.at("/result/status").asString());
        assertEquals("QUANTITY_LIMIT_EXCEEDED",snapshot.at("/result/rejectionCode").asString());
        service.accept(id,input);
        assertEquals(snapshot,json.valueToTree(operations.get(id)));
    }

    @Test
    void unavailableIsBeforeWriteAndClearingItPreservesTheOperation() {
        var id = UUID.randomUUID();
        var input = new OperationInput("REQ-000003",25);
        service.configure(input.getReference(),"UNAVAILABLE");
        assertEquals(503,assertThrows(EmulatorProblem.class,() -> service.accept(id,input)).status);
        assertEquals(404,assertThrows(EmulatorProblem.class,() -> operations.get(id)).status);
        service.clear(input.getReference());
        assertTrue(service.accept(id,input).created());
        service.clear(input.getReference());
        assertNotNull(operations.get(id));
    }

    @Test
    void droppedResponseHasCommittedResultAndHeldEventsUntilExplicitRelease() {
        var id = UUID.randomUUID();
        var input = new OperationInput("REQ-000004",25);
        service.configure(input.getReference(),"DROP_RESPONSE_AFTER_EXECUTION");
        assertTrue(service.accept(id,input).dropResponse());
        var before = json.valueToTree(operations.get(id));
        assertEquals(1,before.get("executions").asInt());
        assertFalse(service.publishNext());
        assertEquals(0,operations.events(0,100).size());
        assertFalse(service.accept(id,input).dropResponse());
        assertEquals(before,json.valueToTree(operations.get(id)));
        service.clear(input.getReference());
        while (service.publishNext()) { }
        assertEquals(2,operations.events(0,100).size());
    }

    @Test
    void duplicateAndLateModesPublishDifferentCursorsWithoutReexecution() {
        var duplicate = new OperationInput("REQ-000005",25);
        var late = new OperationInput("REQ-000006",25);
        service.configure(duplicate.getReference(),"DUPLICATE_RESULT");
        service.configure(late.getReference(),"DELAY_RESULT");
        UUID duplicateId = UUID.randomUUID(), lateId = UUID.randomUUID();
        service.accept(duplicateId,duplicate); service.accept(lateId,late);
        while (service.executeNext()) { }
        while (service.publishNext()) { }
        var events = operations.events(0,100);
        assertEquals(5,events.size());
        var duplicates = events.stream().filter(e -> e.getResult().getOperationId().equals(duplicateId) && e.getResult().getVersion().getValue() == 2).toList();
        assertEquals(2,duplicates.size());
        assertEquals(duplicates.get(0).getResult(),duplicates.get(1).getResult());
        assertNotEquals(duplicates.get(0).getCursor(),duplicates.get(1).getCursor());
        var delayed = events.stream().filter(e -> e.getResult().getOperationId().equals(lateId)).toList();
        assertEquals(2,delayed.get(0).getResult().getVersion().getValue());
        assertEquals(1,delayed.get(1).getResult().getVersion().getValue());
        assertEquals(1,operations.get(lateId).getExecutions().getValue());
    }
}
