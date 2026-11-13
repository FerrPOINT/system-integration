package com.azhukov.integration.application;

import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import com.azhukov.integration.application.port.ExternalExchange;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.CompletableFuture;

@Service
@RequiredArgsConstructor
@Slf4j
public class ExchangeCoordinator implements AutoCloseable {
    private final ExchangeTasks tasks;
    private final ExternalExchange client;
    private final ExecutorService senders = Executors.newFixedThreadPool(4, Thread.ofVirtual().name("delivery-",0).factory());
    private Instant nextRead = Instant.MIN;
    private int feedFailures;
    private boolean feedPaused;

    public void deliver() {
        var pending=new ArrayList<CompletableFuture<Void>>();
        int claimed=0;
        boolean exhausted=false;
        try {
            while (!exhausted && claimed<32) {
                while (pending.size()<4 && claimed<32) {
                    var claim=tasks.claim();
                    if (claim==null) { exhausted=true; break; }
                    claimed++;
                    pending.add(CompletableFuture.runAsync(() -> {
                        long started=System.nanoTime();
                        var reply=client.deliver(claim);
                        tasks.finish(claim,reply);
                        log.info("delivery operationId={} attemptId={} step={} number={} httpStatus={} connectionFailed={} durationMs={}",
                            claim.operationId(),claim.attemptId(),claim.step(),claim.number(),reply.httpStatus(),reply.connectionFailed(),
                            (System.nanoTime()-started)/1_000_000);
                    },senders));
                }
                if (pending.isEmpty()) return;
                CompletableFuture.anyOf(pending.toArray(CompletableFuture[]::new)).join();
                for (var completed=pending.iterator();completed.hasNext();) {
                    var future=completed.next();
                    if (future.isDone()) {
                        future.join(); // Observe every completed failure before releasing its slot.
                        completed.remove();
                    }
                }
            }
        } finally {
            CompletableFuture.allOf(pending.toArray(CompletableFuture[]::new)).join();
        }
    }

    public void receive() {
        if (feedPaused || Instant.now().isBefore(nextRead)) return;
        long after = tasks.cursor();
        var reply = client.events(after);
        if (reply.status() == ExternalExchange.FeedStatus.UNAVAILABLE) {
            feedFailures++;
            int seconds = feedFailures == 1 ? 2 : feedFailures == 2 ? 5 : 15;
            nextRead = Instant.now().plusSeconds(seconds);
            log.warn("result-feed unavailable after={} retrySeconds={}",after,seconds);
            return;
        }
        if (reply.status() == ExternalExchange.FeedStatus.INVALID_PAGE) {
            tasks.badPage(reply.evidence());
            feedPaused = true;
            log.error("result-feed paused after={}: invalid response; fix source and restart worker",after);
            return;
        }
        feedFailures = 0;
        if (!reply.events().isEmpty() && tasks.consume(after,reply.events()))
            log.info("result-feed consumed after={} count={}",after,reply.events().size());
        nextRead = Instant.now().plusMillis(reply.events().isEmpty() ? 1000 : 0);
    }

    @Override public void close() { senders.close(); }
}
