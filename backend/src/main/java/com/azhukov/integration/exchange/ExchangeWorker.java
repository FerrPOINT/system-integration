package com.azhukov.integration.exchange;

import com.azhukov.integration.tasks.ExchangeTasks;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.CompletableFuture;

@Component
@ConditionalOnProperty(name = "si.exchange.enabled", havingValue = "true", matchIfMissing = true)
public class ExchangeWorker implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(ExchangeWorker.class);
    private final ExchangeTasks tasks;
    private final ExchangeClient client;
    private final ExecutorService senders = Executors.newFixedThreadPool(4, Thread.ofVirtual().name("delivery-",0).factory());
    private Instant nextRead = Instant.MIN;
    private int feedFailures;
    private boolean feedPaused;

    public ExchangeWorker(ExchangeTasks tasks, ExchangeClient client) { this.tasks = tasks; this.client = client; }

    @Scheduled(fixedDelay = 100)
    void deliver() {
        // Drain a bounded amount before the idle delay, keeping at most four HTTP calls.
        for (int batch = 0; batch < 8; batch++) {
            var pending = new ArrayList<CompletableFuture<Void>>();
            try {
                for (int n = 0; n < 4; n++) {
                    var claim = tasks.claim();
                    if (claim == null) break;
                    pending.add(CompletableFuture.runAsync(() -> {
                        long started = System.nanoTime();
                        var reply = claim.step().equals("PUT") ? client.put(claim.operationId(),claim.request()) : client.get(claim.operationId());
                        tasks.finish(claim,reply);
                        log.info("delivery operationId={} attemptId={} step={} number={} httpStatus={} connectionFailed={} durationMs={}",
                            claim.operationId(),claim.attemptId(),claim.step(),claim.number(),reply.status(),reply.connectionFailed(),
                            (System.nanoTime()-started)/1_000_000);
                    }, senders));
                }
            } finally {
                CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new)).join();
            }
            if (pending.size() < 4) return;
        }
    }

    @Scheduled(fixedDelay = 200)
    void receive() {
        if (feedPaused || Instant.now().isBefore(nextRead)) return;
        long after = tasks.cursor();
        var reply = client.events(after);
        if (reply.status() == 0 || reply.status() >= 500) {
            feedFailures++;
            int seconds = feedFailures == 1 ? 2 : feedFailures == 2 ? 5 : 15;
            nextRead = Instant.now().plusSeconds(seconds);
            log.warn("result-feed unavailable after={} retrySeconds={}",after,seconds);
            return;
        }
        if (reply.status() != 200 || !validPage(reply.body(),after)) {
            tasks.badPage(reply.body());
            feedPaused = true;
            log.error("result-feed paused after={}: invalid response; fix source and restart worker",after);
            return;
        }
        feedFailures = 0;
        if (tasks.consume(after,reply.body()) && !reply.body().isEmpty())
            log.info("result-feed consumed after={} count={}",after,reply.body().size());
        nextRead = Instant.now().plusMillis(reply.body().isEmpty() ? 1000 : 0);
    }

    public static boolean validPage(JsonNode page, long after) {
        if (page == null || !page.isArray() || page.size() > 100) return false;
        long previous = after;
        for (var event : page) {
            if (!event.isObject()) return false;
            for (var field : event.properties()) if (!field.getKey().equals("cursor") && !field.getKey().equals("result")) return false;
            var cursor = event.get("cursor");
            if (cursor == null || !cursor.isIntegralNumber() || !cursor.canConvertToLong()) return false;
            long value = cursor.longValue();
            if (value <= previous || value > 9007199254740991L) return false;
            previous = value;
        }
        return true;
    }

    @Override public void close() { senders.close(); }
}
