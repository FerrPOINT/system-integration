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
    void aFinishedSelectionPassDoesNotWaitForOneSlowReplyBeforeFillingFreeSlotsAgain() throws Exception {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var claimed = new AtomicInteger();
        var finished = new AtomicInteger();
        var active = new AtomicInteger();
        var peak = new AtomicInteger();
        var peakUnfinished = new AtomicInteger();
        var firstFast = new CountDownLatch(31);
        var allFast = new CountDownLatch(63);
        var slowEntered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        UUID slow = UUID.randomUUID();
        when(tasks.claim())
                .thenAnswer(call -> {
                    int n = claimed.incrementAndGet();
                    peakUnfinished.accumulateAndGet(n - finished.get(), Math::max);
                    return ClaimResult.claimed(
                            new DeliveryAttempt(
                                    n == 1 ? slow : UUID.randomUUID(),
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new TaskInput("REQ-900001", 25)));
                });
        doAnswer(
                        call -> {
                            finished.incrementAndGet();
                            return null;
                        })
                .when(tasks)
                .finish(any(), any());
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    DeliveryAttempt attempt = call.getArgument(0);
                    peak.accumulateAndGet(active.incrementAndGet(), Math::max);
                    try {
                        if (attempt.operationId().equals(slow)) {
                            slowEntered.countDown();
                            assertTrue(release.await(5, TimeUnit.SECONDS));
                        } else {
                            firstFast.countDown();
                            allFast.countDown();
                        }
                        return new ExternalExchangeClient.DeliveryReply(
                                DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                    } finally {
                        active.decrementAndGet();
                    }
                });
        try (var runner = Executors.newVirtualThreadPerTaskExecutor();
                var worker = new ExchangeCoordinator(tasks, client, 8)) {
            var firstPass = runner.submit(worker::deliver);
            try {
                assertTrue(slowEntered.await(1, TimeUnit.SECONDS));
                assertTrue(firstFast.await(2, TimeUnit.SECONDS));
                firstPass.get(250, TimeUnit.MILLISECONDS);
                worker.deliver();
                assertTrue(
                        allFast.await(2, TimeUnit.SECONDS),
                        "The next pass must use free slots while the old reply is held");
                assertEquals(1, release.getCount());
                assertTrue(peak.get() <= 8, "The bound applies across overlapping passes");
                assertTrue(peakUnfinished.get() <= 8, "No attempt can be preclaimed ahead of a free slot");
            } finally {
                release.countDown();
                firstPass.get(5, TimeUnit.SECONDS);
            }
        }
        assertEquals(64, claimed.get(), "Each pass selects at most 32 candidates");
        verify(tasks, times(64)).finish(any(), any());
    }

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
        try (var worker = new ExchangeCoordinator(tasks, client, 8)) {
            worker.deliver();
        }
        assertTrue(claimed.get() > 8, "a backlog should not wait after every eight records");
        assertTrue(claimed.get() <= 32, "one scheduler turn must remain bounded");
        assertTrue(peak.get() <= 8);
        verify(tasks, times(claimed.get())).finish(any(), any());
        assertEquals(claimed.get(), threads.size(), "Each delivery is its own virtual thread");
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
                var worker = new ExchangeCoordinator(tasks, client, 8)) {
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
        }
        assertEquals(32, claimed.get());
        assertTrue(peakUnfinishedClaims.get() <= 8, "No attempts may be claimed ahead of free slots");
        verify(tasks, times(32)).finish(any(), any());
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
                var worker = new ExchangeCoordinator(tasks, client, 8)) {
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
        }
        assertEquals(32, claimed.get());
        verify(tasks, times(32)).finish(any(), any());
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
                var worker = new ExchangeCoordinator(tasks, client, 8)) {
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
        }
        assertEquals(32, claims.get());
        verify(tasks, times(31)).finish(any(), any());
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
        try (var worker = new ExchangeCoordinator(tasks, client, 8)) {
            worker.deliver();
        }
        verify(tasks).finish(any(), any());
        assertTrue(calls.get() <= 32);
    }

    @Test
    void aPassWithOnlyChangedCandidatesStillHasAFiniteSelectionLimit() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        when(tasks.claim()).thenReturn(ClaimResult.skipped());
        try (var worker = new ExchangeCoordinator(tasks, client, 8)) {
            worker.deliver();
            verify(tasks, times(32)).claim();
            verifyNoInteractions(client);
        }
    }

    @Test
    void configuredSlotsStartWithoutClaimingWorkAheadOfReplies() throws Exception {
        for (int slots : new int[] {4, 8, 16, 32}) {
            var tasks = mock(ExchangeService.class);
            var client = mock(ExternalExchangeClient.class);
            var claimed = new AtomicInteger();
            var entered = new CountDownLatch(slots);
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
                    var worker = new ExchangeCoordinator(tasks, client, slots)) {
                var cycle = runner.submit(worker::deliver);
                try {
                    assertTrue(entered.await(2, TimeUnit.SECONDS), "All configured slots must start: " + slots);
                    assertEquals(slots, claimed.get(), "Every occupied slot owns exactly one lease");
                } finally {
                    release.countDown();
                    cycle.get(5, TimeUnit.SECONDS);
                }
            }
            assertEquals(32, claimed.get());
            verify(tasks, times(32)).finish(any(), any());
        }
    }

    @Test
    void invalidSlotConfigurationFailsBeforeStartingWork() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        for (int value : new int[] {-1, 0, 33})
            assertThrows(IllegalArgumentException.class, () -> new ExchangeCoordinator(tasks, client, value));
        verifyNoInteractions(tasks, client);
    }

    @Test
    void aFailedPeerIsReportedAndOtherSubmittedAttemptsFinishBeforeShutdownReturns() {
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
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(ExchangeCoordinator.class);
        var events = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        events.start();
        logger.addAppender(events);
        try {
            try (var worker = new ExchangeCoordinator(tasks, client, 8)) {
                try {
                    worker.deliver();
                } catch (java.util.concurrent.CompletionException failure) {
                    assertInstanceOf(IllegalStateException.class, failure.getCause());
                }
            }
            verify(tasks, times(3)).finish(any(), any());
            assertEquals(
                    1,
                    events.list.stream()
                            .filter(event ->
                                    event.getLevel() == ch.qos.logback.classic.Level.ERROR
                                            && event.getFormattedMessage()
                                                    .equals("delivery slot failed exception=IllegalStateException"))
                            .count());
            assertTrue(
                    events.list.stream()
                            .noneMatch(event -> event.getFormattedMessage().contains("Controlled peer failure")),
                    "Exception messages may contain SQL values");
        } finally {
            logger.detachAppender(events);
            events.stop();
        }
    }

    @Test
    void failedInitialProbeReturnsItsReservedSlot() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        when(tasks.claim())
                .thenThrow(new IllegalStateException("Controlled claim failure"))
                .thenReturn(ClaimResult.empty());
        try (var worker = new ExchangeCoordinator(tasks, client, 1)) {
            assertThrows(IllegalStateException.class, worker::deliver);
            worker.deliver();
            verify(tasks, times(2)).claim();
            verifyNoInteractions(client);
        }
    }

    @Test
    void failedSenderReturnsItsReservedSlotBeforeAnotherPass() {
        var tasks = mock(ExchangeService.class);
        var client = mock(ExternalExchangeClient.class);
        var attempt =
                new DeliveryAttempt(UUID.randomUUID(), UUID.randomUUID(), "PUT", 1, 1, new TaskInput("REQ-900001", 25));
        when(tasks.claim()).thenReturn(ClaimResult.claimed(attempt), ClaimResult.empty());
        when(client.deliver(attempt)).thenThrow(new IllegalStateException("Controlled sender failure"));
        try (var worker = new ExchangeCoordinator(tasks, client, 1)) {
            assertThrows(java.util.concurrent.CompletionException.class, worker::deliver);
            worker.deliver();
            assertEquals(0, worker.diagnostics().deliveryInFlight());
            verify(tasks, times(2)).claim();
            verify(tasks, never()).finish(any(), any());
        }
    }

    @Test
    void emptyQueueStopsWithoutCallingTheExternalSystem() {
        var tasks = mock(ExchangeService.class);
        when(tasks.claim()).thenReturn(ClaimResult.empty());
        var client = mock(ExternalExchangeClient.class);
        try (var worker = new ExchangeCoordinator(tasks, client, 8)) {
            worker.deliver();
            verify(tasks).claim();
            verifyNoInteractions(client);
        }
    }
}
