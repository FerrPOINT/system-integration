package com.azhukov.integration.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.client.ExternalExchangeClient.IncomingEvent;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.*;
import com.azhukov.integration.repository.ExchangeRepository;
import com.azhukov.integration.repository.TaskRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ExchangeServiceTest {
    private final TaskRepository tasks = mock(TaskRepository.class);
    private final ExchangeRepository exchanges = mock(ExchangeRepository.class);
    private final IssueLifecycleService issues = mock(IssueLifecycleService.class);
    private final ExchangeService service = new ExchangeService(tasks, exchanges, issues);
    private final UUID operation = UUID.randomUUID();
    private final TaskInput input = new TaskInput("REQ-123456", 25);
    private final OffsetDateTime at = OffsetDateTime.parse("2026-01-01T00:00:00Z");

    private ExchangeState state(DeliveryStatus delivery) {
        return new ExchangeState(
                new Task(
                        UUID.randomUUID(),
                        operation,
                        UUID.randomUUID(),
                        new TaskTitle("Задание", 1),
                        input,
                        delivery,
                        BusinessStatus.PENDING,
                        at,
                        null),
                1,
                null);
    }

    private OperationResult terminal() {
        return new OperationResult(operation, input, 2, BusinessStatus.SUCCEEDED, at, null);
    }

    @Test
    void acknowledgedDeliveryDoesNotRepeatCompletedQueueAndIssueCleanup() {
        var state = state(DeliveryStatus.ACKNOWLEDGED);
        var result = terminal();
        var applied = service.apply(state, result, null);
        assertEquals(result, applied.result());
        assertEquals(DeliveryStatus.ACKNOWLEDGED, applied.task().deliveryStatus());
        verify(exchanges).applyResult(result);
        verify(exchanges, never()).removeQueue(any());
        verifyNoInteractions(issues);
        verify(tasks).history(eq(state.task()), isNull(), eq(HistoryType.RESULT_APPLIED), anyString(), any());
    }

    @Test
    void applyingResultStillCleansEveryUnacknowledgedDeliveryState() {
        for (var delivery : DeliveryStatus.values()) {
            if (delivery == DeliveryStatus.ACKNOWLEDGED) continue;
            var state = state(delivery);
            var applied = service.apply(state, terminal(), null);
            assertEquals(DeliveryStatus.ACKNOWLEDGED, applied.task().deliveryStatus());
            verify(exchanges).removeQueue(operation);
            verify(issues).confirm(state);
            clearInvocations(exchanges, issues);
        }
    }

    @Test
    void firstSnapshotConfirmsDeliveryAndLaterSnapshotStillAppliesWithOneCleanup() {
        var initial = state(DeliveryStatus.UNKNOWN);
        var running = new OperationResult(operation, input, 1, BusinessStatus.RUNNING, null, null);
        var terminal = terminal();
        when(exchanges.cursor(true)).thenReturn(0L);
        when(exchanges.lockExchanges(List.of(operation))).thenReturn(Map.of(operation, initial));
        assertTrue(
                service.consume(
                        0,
                        List.of(
                                new IncomingEvent(1, operation, running, running),
                                new IncomingEvent(2, operation, terminal, terminal))));
        verify(exchanges).applyResult(running);
        verify(exchanges).applyResult(terminal);
        verify(exchanges).removeQueue(operation);
        verify(issues).confirm(initial);
        verify(exchanges).advanceCursor(2);
        verify(tasks, times(2)).history(any(), isNull(), eq(HistoryType.RESULT_APPLIED), anyString(), any());
    }
}
