package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Runs HTTP between claim/finish transactions: eight in-flight requests and at most
 * 32 claims per pass. This bean owns/closes the per-task virtual executor.
 * These bounds protect resources; they are not a throughput promise.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ExchangeCoordinator implements AutoCloseable {
    private final ExchangeService tasks;
    private final ExternalExchangeClient client;
    private static final int MAX_IN_FLIGHT = 8;
    private final ExecutorService senders =
            Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("delivery-", 0).factory());
    private Instant nextRead = Instant.MIN;
    private volatile int feedFailures;
    private volatile boolean feedPaused;
    private volatile Instant lastSuccessfulRead;
    private final java.util.concurrent.atomic.LongAdder unavailableReads = new java.util.concurrent.atomic.LongAdder();
    private final java.util.concurrent.atomic.LongAdder invalidPages = new java.util.concurrent.atomic.LongAdder();
    private final java.util.concurrent.atomic.AtomicInteger inFlight = new java.util.concurrent.atomic.AtomicInteger();

    /** Process-local observations; restart resets counters, while the delivery queue stays in PostgreSQL. */
    public record FeedDiagnostics(
            boolean paused,
            Instant lastSuccessfulRead,
            int consecutiveFailures,
            long unavailableReads,
            long invalidPages,
            int deliveryInFlight) {}

    public FeedDiagnostics diagnostics() {
        return new FeedDiagnostics(
                feedPaused,
                lastSuccessfulRead,
                feedFailures,
                unavailableReads.sum(),
                invalidPages.sum(),
                inFlight.get());
    }

    public void deliver() {
        // Probe once while idle. Only reserved slots may claim work after this.
        var first = claim();
        if (first == null) return;
        var pending = new ArrayList<CompletableFuture<Boolean>>();
        int submitted = 1;
        boolean exhausted = false;
        try {
            pending.add(
                    CompletableFuture.supplyAsync(
                            () -> {
                                deliverClaim(first);
                                return true;
                            },
                            senders));
            while (!exhausted && submitted < 32) {
                while (pending.size() < MAX_IN_FLIGHT && submitted < 32) {
                    pending.add(
                            CompletableFuture.supplyAsync(
                                    () -> {
                                        var next = claim();
                                        if (next == null) return false;
                                        deliverClaim(next);
                                        return true;
                                    },
                                    senders));
                    submitted++;
                }
                CompletableFuture.anyOf(pending.toArray(CompletableFuture[]::new)).join();
                for (var completed = pending.iterator(); completed.hasNext(); ) {
                    var future = completed.next();
                    if (future.isDone()) {
                        if (!future.join()) exhausted = true;
                        completed.remove();
                    }
                }
            }
        } finally {
            CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new)).join();
        }
    }

    private DeliveryAttempt claim() {
        long started = System.nanoTime();
        var result = tasks.claim();
        log.debug("delivery-claim durationMs={}", (System.nanoTime() - started) / 1_000_000);
        return result;
    }

    private void deliverClaim(DeliveryAttempt claim) {
        long started = System.nanoTime();
        inFlight.incrementAndGet();
        try {
            var reply = client.deliver(claim);
            long received = System.nanoTime();
            tasks.finish(claim, reply);
            long finished = System.nanoTime();
            log.info(
                    "delivery operationId={} attemptId={} step={} number={} httpStatus={} connectionFailed={} durationMs={} httpMs={} finishMs={}",
                    claim.operationId(),
                    claim.attemptId(),
                    claim.step(),
                    claim.number(),
                    reply.httpStatus(),
                    reply.connectionFailed(),
                    (finished - started) / 1_000_000,
                    (received - started) / 1_000_000,
                    (finished - received) / 1_000_000);
        } finally {
            inFlight.decrementAndGet();
        }
    }

    public void receive() {
        if (feedPaused || Instant.now().isBefore(nextRead)) return;
        long after = tasks.cursor();
        var reply = client.events(after);
        if (reply.status() == ExternalExchangeClient.FeedStatus.UNAVAILABLE) {
            feedFailures++;
            unavailableReads.increment();
            int seconds = feedFailures == 1 ? 2 : feedFailures == 2 ? 5 : 15;
            nextRead = Instant.now().plusSeconds(seconds);
            log.warn("result-feed unavailable after={} retrySeconds={}", after, seconds);
            return;
        }
        if (reply.status() == ExternalExchangeClient.FeedStatus.INVALID_PAGE) {
            tasks.badPage(reply.evidence());
            invalidPages.increment();
            feedPaused = true;
            log.error("result-feed paused after={}: invalid response; fix source and restart worker", after);
            return;
        }
        feedFailures = 0;
        if (!reply.events().isEmpty() && tasks.consume(after, reply.events()))
            log.info("result-feed consumed after={} count={}", after, reply.events().size());
        lastSuccessfulRead = Instant.now();
        nextRead = lastSuccessfulRead.plusMillis(reply.events().isEmpty() ? 1000 : 0);
    }

    @Override
    public void close() {
        senders.close();
    }
}
