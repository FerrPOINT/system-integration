package com.azhukov.integration.exchange;

import com.azhukov.integration.tasks.ExchangeTasks;
import com.azhukov.integration.contract.ExchangeReply;
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
        var client = mock(ExchangeClient.class);
        var claimed = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        when(tasks.claim()).thenAnswer(call -> {
            if (claimed.incrementAndGet() > 40) return null;
            return new ExchangeTasks.Claim(UUID.randomUUID(), UUID.randomUUID(), "PUT", 1,
                new TaskInput("REQ-900001", 25));
        });
        when(client.put(any(), any())).thenAnswer(call -> {
            int current = active.incrementAndGet();
            try { peak.accumulateAndGet(current, Math::max); return new ExchangeReply(202, null, false); }
            finally { active.decrementAndGet(); }
        });
        try (var worker = new ExchangeWorker(tasks, client)) {
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
        var client = mock(ExchangeClient.class);
        try (var worker = new ExchangeWorker(tasks, client)) {
            worker.deliver();
            verify(tasks).claim();
            verifyNoInteractions(client);
        }
    }
}
