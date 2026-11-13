package com.azhukov.integration.exchange;

import com.azhukov.integration.application.ExchangeCoordinator;

import com.azhukov.integration.domain.exchange.DeliveryAttempt;

import com.azhukov.integration.application.ExchangeTasks;
import com.azhukov.integration.domain.task.TaskInput;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ExchangeWorkerTest {
    @Test
    void drainsMoreThanOneBatchButBoundsEachCycleAndParallelHttpCalls() throws Exception {
        var tasks = mock(ExchangeTasks.class);
        var client = mock(com.azhukov.integration.application.port.ExternalExchange.class);
        var claimed = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        when(tasks.claim()).thenAnswer(call -> {
            if (claimed.incrementAndGet() > 40) return null;
            return new DeliveryAttempt(UUID.randomUUID(), UUID.randomUUID(), "PUT", 1,
                new TaskInput("REQ-900001", 25));
        });
        when(client.deliver(any())).thenAnswer(call -> {
            int current = active.incrementAndGet();
            try { peak.accumulateAndGet(current, Math::max); return new com.azhukov.integration.application.port.ExternalExchange.DeliveryReply(DeliveryAttempt.Outcome.ACKNOWLEDGED,202,false,null,null); }
            finally { active.decrementAndGet(); }
        });
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            assertTrue(claimed.get() > 4, "a backlog should not wait after every four records");
            assertTrue(claimed.get() <= 32, "one scheduler turn must remain bounded");
            assertTrue(peak.get() <= 4);
            verify(tasks, times(claimed.get())).finish(any(), any());
        }
    }

    @Test
    void emptyQueueStopsWithoutCallingTheExternalSystem() {
        var tasks = mock(ExchangeTasks.class);
        var client = mock(com.azhukov.integration.application.port.ExternalExchange.class);
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            verify(tasks).claim();
            verifyNoInteractions(client);
        }
    }
}
