package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.repository.jdbc.JdbcExchangeRepository;
import com.azhukov.integration.service.TaskService;
import com.azhukov.integration.support.PostgresTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.ObjectMapper;

class TaskMappingTest extends PostgresTest {
    @Autowired TaskService reads;
    @Autowired JdbcExchangeRepository exchanges;
    @MockitoSpyBean ObjectMapper observedJson;

    @Test
    void runningCardDoesNotDecodeAnExternalResultItDoesNotExpose() throws Exception {
        var task = running();
        clearInvocations(observedJson);
        var card = reads.get(new Actor(first, Actor.Role.INITIATOR), task.id());
        assertEquals(BusinessStatus.RUNNING, card.businessStatus());
        assertNull(card.outcome());
        verify(observedJson, never()).readValue(anyString(), eq(OperationResult.class));
        verify(observedJson, never()).readTree(anyString());
    }

    @Test
    void exchangeDecodesTheAcceptedSnapshotOnceForDeduplication() throws Exception {
        var task = running();
        clearInvocations(observedJson);
        var state = exchanges.exchange(task.operation(), false);
        assertEquals(1, state.result().version());
        assertNull(state.task().outcome());
        verify(observedJson, times(1)).readValue(anyString(), eq(OperationResult.class));
        verify(observedJson, never()).readTree(anyString());
    }

    @Test
    void terminalCardReadsOnlyItsDisplayedOutcome() throws Exception {
        var task = running();
        var result = new java.util.LinkedHashMap<String, Object>(identity(task.operation()));
        result.put("version", 2);
        result.put("status", "SUCCEEDED");
        result.put("completedAt", "2026-01-01T00:00:01Z");
        jdbc.update(
                "UPDATE tasks SET business_status='SUCCEEDED',accepted_result=?::jsonb WHERE id=?",
                json.writeValueAsString(result),
                task.id());
        clearInvocations(observedJson);
        var card = reads.get(new Actor(first, Actor.Role.INITIATOR), task.id());
        assertEquals(BusinessStatus.SUCCEEDED, card.outcome().status());
        assertEquals("2026-01-01T00:00:01Z", card.outcome().completedAt().toString());
        verify(observedJson, never()).readValue(anyString(), eq(OperationResult.class));
        verify(observedJson, times(1)).readTree(anyString());
    }

    @Test
    void rejectedOutcomeKeepsItsReasonAtTheHttpBoundary() throws Exception {
        var task = running();
        var result = new java.util.LinkedHashMap<String, Object>(identity(task.operation()));
        result.put("version", 2);
        result.put("status", "REJECTED");
        result.put("completedAt", "2026-01-01T00:00:01Z");
        result.put("rejectionCode", "QUANTITY_LIMIT_EXCEEDED");
        jdbc.update(
                "UPDATE tasks SET business_status='REJECTED',accepted_result=?::jsonb WHERE id=?",
                json.writeValueAsString(result),
                task.id());
        var owner = login("initiator.one");
        var response = mvc.perform(get("/api/tasks/" + task.id()).session(owner.session())).andReturn();
        status(200, response);
        assertEquals("REJECTED", body(response).at("/result/status").asString());
        assertEquals("QUANTITY_LIMIT_EXCEEDED", body(response).at("/result/rejectionCode").asString());
    }

    private Stored running() throws Exception {
        var id = created(login("initiator.one"), UUID.randomUUID());
        var operation = jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", UUID.class, id);
        var result = new java.util.LinkedHashMap<String, Object>(identity(operation));
        result.put("version", 1);
        result.put("status", "RUNNING");
        jdbc.update(
                "UPDATE tasks SET business_status='RUNNING',accepted_result=?::jsonb WHERE id=?",
                json.writeValueAsString(result),
                id);
        return new Stored(id, operation);
    }

    private Map<String, Object> identity(UUID operation) {
        return Map.of("operationId", operation, "request", Map.of("reference", "REQ-000001", "quantity", 25));
    }

    private record Stored(UUID id, UUID operation) {}
}
