package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.dto.exchange.ClaimResult;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Runs HTTP between claim/finish transactions: bounded in-flight requests and at most
 * 32 claims per pass. This bean owns/closes the per-task virtual executor.
 * These bounds protect resources; they are not a throughput promise.
 */
@Service
@Slf4j
public class ExchangeCoordinator implements AutoCloseable {
    private final ExchangeService tasks;
    private final ExternalExchangeClient client;
    private final int maxInFlight;
    private static final int MAX_CLAIMS_PER_PASS = 32;
    private final ExecutorService senders;
    private Instant retryAfter = Instant.MIN;
    private volatile int feedFailures;
    private volatile boolean feedPaused;
    private volatile Instant lastSuccessfulRead;
    private final java.util.concurrent.atomic.LongAdder unavailableReads = new java.util.concurrent.atomic.LongAdder();
    private final java.util.concurrent.atomic.LongAdder invalidPages = new java.util.concurrent.atomic.LongAdder();
    private final java.util.concurrent.atomic.AtomicInteger inFlight = new java.util.concurrent.atomic.AtomicInteger();

    public ExchangeCoordinator(
            ExchangeService tasks,
            ExternalExchangeClient client,
            @Value("${si.exchange.max-in-flight}") int maxInFlight) {
        if (maxInFlight < 1 || maxInFlight > MAX_CLAIMS_PER_PASS)
            throw new IllegalArgumentException("si.exchange.max-in-flight must be 1.." + MAX_CLAIMS_PER_PASS);
        this.tasks = tasks;
        this.client = client;
        this.maxInFlight = maxInFlight;
        this.senders = Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("delivery-", 0).factory());
        log.info("delivery-worker slots={} selectionsPerPass={}", maxInFlight, MAX_CLAIMS_PER_PASS);
    }

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
        // An empty queue costs one probe; maintenance must not masquerade as emptiness.
        int submitted = 0;
        ClaimResult first;
        do {
            first = claim();
            submitted++;
        } while (first.outcome() == ClaimResult.Outcome.SKIPPED && submitted < MAX_CLAIMS_PER_PASS);
        if (first.attempt() == null) return;
        var initial = first.attempt();
        var pending = new ArrayList<CompletableFuture<Boolean>>();
        boolean exhausted = false;
        try {
            pending.add(
                    CompletableFuture.supplyAsync(
                            () -> {
                                deliverClaim(initial);
                                return true;
                            },
                            senders));
            while (!exhausted && submitted < MAX_CLAIMS_PER_PASS) {
                while (pending.size() < maxInFlight && submitted < MAX_CLAIMS_PER_PASS) {
                    pending.add(
                            CompletableFuture.supplyAsync(
                                    () -> {
                                        var next = claim();
                                        if (next.attempt() != null) deliverClaim(next.attempt());
                                        return next.outcome() != ClaimResult.Outcome.EMPTY;
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

    private ClaimResult claim() {
        long started = System.nanoTime();
        var result = tasks.claim();
        log.debug(
                "delivery-claim durationMs={} outcome={}", (System.nanoTime() - started) / 1_000_000, result.outcome());
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
        if (feedPaused || Instant.now().isBefore(retryAfter)) return;
        long after = tasks.cursor();
        var reply = client.events(after);
        if (reply.status() == ExternalExchangeClient.FeedStatus.UNAVAILABLE) {
            feedFailures++;
            unavailableReads.increment();
            int seconds = feedFailures == 1 ? 2 : feedFailures == 2 ? 5 : 15;
            retryAfter = Instant.now().plusSeconds(seconds);
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
        // The scheduler owns normal cadence; successful reads clear failure backoff.
        retryAfter = Instant.MIN;
    }

    @Override
    public void close() {
        senders.close();
    }
}
