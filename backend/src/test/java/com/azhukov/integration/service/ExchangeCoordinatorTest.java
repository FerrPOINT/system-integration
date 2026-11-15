package com.azhukov.integration.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.dto.exchange.ClaimResult;
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
                    if (claimed.incrementAndGet() > 40) return ClaimResult.empty();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
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
            assertTrue(claimed.get() > 8, "a backlog should not wait after every eight records");
            assertTrue(claimed.get() <= 32, "one scheduler turn must remain bounded");
            assertTrue(peak.get() <= 8);
            verify(tasks, times(claimed.get())).finish(any(), any());
            assertEquals(claimed.get(), threads.size(), "Each delivery is its own virtual thread");
        }
    }

    @Test
    void oneSlowResponseDoesNotHoldTheOtherSevenSlotsOrPreclaimWaitingWork() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        UUID slow = UUID.randomUUID();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var fifteenFast = new CountDownLatch(15);
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
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    n == 1 ? slow : UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
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
                        } else fifteenFast.countDown();
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
                assertTrue(fifteenFast.await(1, TimeUnit.SECONDS), "Free slots must progress before the slow response");
                assertEquals(1, release.getCount(), "The slow response is still held");
                assertTrue(peak.get() <= 8);
                // Only one active request plus up to seven other slots can own unfinished attempts.
                assertTrue(claimed.get() <= 32, "A turn must stay bounded");
            } finally {
                release.countDown();
                cycle.get(5, TimeUnit.SECONDS);
            }
            assertEquals(32, claimed.get());
            assertTrue(peakUnfinishedClaims.get() <= 8, "No attempts may be claimed ahead of free slots");
            verify(tasks, times(32)).finish(any(), any());
        }
    }

    @Test
    void oneSlowClaimDoesNotSerializeOtherReservedSlots() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var slowEntered = new CountDownLatch(1);
        var otherClaim = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(tasks.claim())
                .thenAnswer(call -> {
                    int number = claimed.incrementAndGet();
                    if (number == 2) {
                        slowEntered.countDown();
                        assertTrue(release.await(5, TimeUnit.SECONDS));
                    }
                    if (number > 2) otherClaim.countDown();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
                });
        when(client.deliver(any()))
                .thenReturn(
                        new ExternalExchangeClient.DeliveryReply(
                                DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null));
        try (var runner = Executors.newVirtualThreadPerTaskExecutor();
                var worker = new ExchangeCoordinator(tasks, client)) {
            var cycle = runner.submit(worker::deliver);
            try {
                assertTrue(slowEntered.await(2, TimeUnit.SECONDS));
                assertTrue(
                        otherClaim.await(2, TimeUnit.SECONDS),
                        "A DB wait in one reserved slot must not serialize the other claims");
            } finally {
                release.countDown();
                cycle.get(5, TimeUnit.SECONDS);
            }
            assertEquals(32, claimed.get());
            verify(tasks, times(32)).finish(any(), any());
        }
    }

    @Test
    void aSkippedCandidateDoesNotExhaustOtherAvailableWork() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claims = new AtomicInteger();
        var ninth = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(tasks.claim())
                .thenAnswer(call -> {
                    int n = claims.incrementAndGet();
                    if (n == 2) return ClaimResult.skipped();
                    if (n == 9) ninth.countDown();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
                });
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    assertTrue(release.await(5, TimeUnit.SECONDS));
                    return new ExternalExchangeClient.DeliveryReply(
                            DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                });
        try (var runner = Executors.newVirtualThreadPerTaskExecutor();
                var worker = new ExchangeCoordinator(tasks, client)) {
            var cycle = runner.submit(worker::deliver);
            try {
                assertTrue(
                        ninth.await(2, TimeUnit.SECONDS),
                        "One stale candidate must not end a pass with other available work");
                assertEquals(9, claims.get(), "Eight leases plus one skipped candidate");
            } finally {
                release.countDown();
                cycle.get(5, TimeUnit.SECONDS);
            }
            assertEquals(32, claims.get());
            verify(tasks, times(31)).finish(any(), any());
        }
    }

    @Test
    void maintenanceBeforeTheFirstLeaseDoesNotHideReadyWork() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var calls = new AtomicInteger();
        when(tasks.claim())
                .thenAnswer(call -> {
                    int n = calls.incrementAndGet();
                    if (n == 1) return ClaimResult.skipped();
                    if (n > 2) return ClaimResult.empty();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
                });
        when(client.deliver(any()))
                .thenReturn(
                        new ExternalExchangeClient.DeliveryReply(
                                DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null));
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            verify(tasks).finish(any(), any());
            assertTrue(calls.get() <= 32);
        }
    }

    @Test
    void aPassWithOnlyChangedCandidatesStillHasAFiniteSelectionLimit() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        when(tasks.claim()).thenReturn(ClaimResult.skipped());
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            verify(tasks, times(32)).claim();
            verifyNoInteractions(client);
        }
    }

    @Test
    void allEightSlotsCanStartWithoutClaimingWorkAheadOfTheirReplies() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var entered = new CountDownLatch(8);
        var release = new CountDownLatch(1);
        when(tasks.claim())
                .thenAnswer(call -> {
                    claimed.incrementAndGet();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
                });
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    entered.countDown();
                    assertTrue(release.await(5, TimeUnit.SECONDS));
                    return new ExternalExchangeClient.DeliveryReply(
                            DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                });
        try (var runner = Executors.newVirtualThreadPerTaskExecutor();
                var worker = new ExchangeCoordinator(tasks, client)) {
            var cycle = runner.submit(worker::deliver);
            try {
                assertTrue(entered.await(2, TimeUnit.SECONDS));
                assertEquals(8, claimed.get(), "Every occupied slot owns exactly one lease");
            } finally {
                release.countDown();
                cycle.get(5, TimeUnit.SECONDS);
            }
            assertEquals(32, claimed.get());
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
                    if (n > 4) return ClaimResult.empty();
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    n == 2 ? failed : UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
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
        when(tasks.claim()).thenReturn(ClaimResult.empty());
        var client = mock(ExternalExchangeClient.class);
        try (var worker = new ExchangeCoordinator(tasks, client)) {
            worker.deliver();
            verify(tasks).claim();
            verifyNoInteractions(client);
        }
    }
}
