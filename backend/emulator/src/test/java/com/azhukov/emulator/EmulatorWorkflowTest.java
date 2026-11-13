package com.azhukov.emulator;

import com.azhukov.emulator.domain.*;
import com.azhukov.emulator.application.OperationService;
import com.azhukov.emulator.infrastructure.jdbc.OperationRepository;
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
        assertFalse(service.publishNext());
        assertEquals(0,operations.events(0,100).size());
        assertFalse(service.accept(id,input).dropResponse());
        assertEquals(before,json.valueToTree(operations.get(id)));
        service.clear(input.reference());
        while (service.publishNext()) { }
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
        while (service.publishNext()) { }
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
