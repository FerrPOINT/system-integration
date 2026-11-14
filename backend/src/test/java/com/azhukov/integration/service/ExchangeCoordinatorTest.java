package com.azhukov.integration.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.task.TaskInput;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class ExchangeCoordinatorTest {
    @Test
    void drainsMoreThanOneBatchButBoundsEachCycleAndParallelHttpCalls() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        var threads = java.util.concurrent.ConcurrentHashMap.<Thread>newKeySet();
        when(tasks.claim())
                .thenAnswer(call -> {
                    if (claimed.incrementAndGet() > 40) return null;
                    return new DeliveryAttempt(
                            UUID.randomUUID(), UUID.randomUUID(), "PUT", 1, 1, new TaskInput("REQ-900001", 25));
                });
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    assertTrue(Thread.currentThread().isVirtual());
                    threads.add(Thread.currentThread());
                    int current = active.incrementAndGet();
                    try {
                        peak.accumulateAndGet(current, Math::max);
                        return new ExternalExchangeClient.DeliveryReply(
                                DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                    } finally {
                        active.decrementAndGet();
                    }
                });
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            assertTrue(claimed.get() > 4, "a backlog should not wait after every four records");
            assertTrue(claimed.get() <= 32, "one scheduler turn must remain bounded");
            assertTrue(peak.get() <= 4);
            verify(tasks, times(claimed.get())).finish(any(), any());
            assertEquals(claimed.get(), threads.size(), "Each delivery is its own virtual thread");
        }
    }

    @Test
    void oneSlowResponseDoesNotHoldTheOtherThreeSlotsOrPreclaimWaitingWork() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        UUID slow = UUID.randomUUID();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var sevenFast = new CountDownLatch(7);
        var finished = new AtomicInteger();
        var peakUnfinishedClaims = new AtomicInteger();
        doAnswer(
                        call -> {
                            finished.incrementAndGet();
                            return null;
                        })
                .when(tasks)
                .finish(any(), any());
        when(tasks.claim())
                .thenAnswer(call -> {
                    int n = claimed.incrementAndGet();
                    peakUnfinishedClaims.accumulateAndGet(n - finished.get(), Math::max);
                    return new DeliveryAttempt(
                            n == 1 ? slow : UUID.randomUUID(),
                            UUID.randomUUID(),
                            "PUT",
                            1,
                            1,
                            new TaskInput("REQ-900001", 25));
                });
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    DeliveryAttempt attempt = call.getArgument(0);
                    int n = active.incrementAndGet();
                    peak.accumulateAndGet(n, Math::max);
                    try {
                        if (attempt.operationId().equals(slow)) {
                            entered.countDown();
                            assertTrue(release.await(5, TimeUnit.SECONDS));
                        } else sevenFast.countDown();
                        return new ExternalExchangeClient.DeliveryReply(
                                DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                    } finally {
                        active.decrementAndGet();
                    }
                });
        try (var runner = Executors.newVirtualThreadPerTaskExecutor();
                var worker = new ExchangeCoordinator(tasks, client)) {
            var cycle = runner.submit(worker::deliver);
            try {
                assertTrue(entered.await(1, TimeUnit.SECONDS), "The slow operation must actually start");
                assertTrue(sevenFast.await(1, TimeUnit.SECONDS), "Free slots must progress before the slow response");
                assertEquals(1, release.getCount(), "The slow response is still held");
                assertTrue(peak.get() <= 4);
                // Only one active request plus up to three other slots can own unfinished attempts.
                assertTrue(claimed.get() <= 32, "A turn must stay bounded");
            } finally {
                release.countDown();
                cycle.get(5, TimeUnit.SECONDS);
            }
            assertEquals(32, claimed.get());
            assertTrue(peakUnfinishedClaims.get() <= 4, "No attempts may be claimed ahead of free slots");
            verify(tasks, times(32)).finish(any(), any());
        }
    }

    @Test
    void aFailedPeerIsPropagatedAndOtherSubmittedAttemptsFinishBeforeReturn() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        UUID failed = UUID.randomUUID();
        when(tasks.claim())
                .thenAnswer(call -> {
                    int n = claimed.incrementAndGet();
                    if (n > 4) return null;
                    return new DeliveryAttempt(
                            n == 2 ? failed : UUID.randomUUID(),
                            UUID.randomUUID(),
                            "PUT",
                            1,
                            1,
                            new TaskInput("REQ-900001", 25));
                });
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    DeliveryAttempt attempt = call.getArgument(0);
                    if (attempt.operationId().equals(failed))
                        throw new IllegalStateException("Controlled peer failure");
                    return new ExternalExchangeClient.DeliveryReply(
                            DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                });
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            assertThrows(java.util.concurrent.CompletionException.class, worker::deliver);
            verify(tasks, times(3)).finish(any(), any());
        }
    }

    @Test
    void emptyQueueStopsWithoutCallingTheExternalSystem() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            verify(tasks).claim();
            verifyNoInteractions(client);
        }
    }
}
