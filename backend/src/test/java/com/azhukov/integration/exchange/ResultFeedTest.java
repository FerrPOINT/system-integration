package com.azhukov.integration.exchange;

import com.azhukov.integration.support.PostgresTest;
import com.azhukov.integration.tasks.ExchangeTasks;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class ResultFeedTest extends PostgresTest {
    @Autowired ExchangeTasks exchange;

    @Test
    void invalidCursorPausesWithoutAdvancingAndRestartCanConsumeCorrectedSource() throws Exception {
        jdbc.update("UPDATE incoming_position SET last_cursor = 7 WHERE id = 1");
        var requests = new AtomicInteger();
        var page = new AtomicReference<>("[{\"cursor\":8},{\"cursor\":7}]");
        var server = source(requests, page, new AtomicInteger(200));
        try (var client = new ExchangeClient(json, origin(server))) {
            try (var worker = new ExchangeWorker(exchange, client)) {
                worker.receive();
                worker.receive();
                assertEquals(1, requests.get(), "A bad cursor must pause the consumer");
                assertEquals(7, exchange.cursor());
                assertEquals(1, count("exchange_issues"));
                assertEquals(0, count("task_history"));
            }
            // A valid cursor with an invalid result is diagnosed and consumed, rather than poisoning the feed.
            page.set("[{\"cursor\":8,\"result\":null}]");
            try (var restarted = new ExchangeWorker(exchange, client)) {
                restarted.receive();
                assertEquals(2, requests.get());
                assertEquals(8, exchange.cursor());
                assertEquals(2, count("exchange_issues"));
                assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM exchange_issues WHERE task_id IS NULL AND status = 'OPEN'", Integer.class));
            }
        } finally { server.stop(0); }
    }

    @Test
    void temporaryFeedFailureDoesNotAdvanceOrSpin() throws Exception {
        var requests = new AtomicInteger();
        var server = source(requests, new AtomicReference<>("{}"), new AtomicInteger(503));
        try (var client = new ExchangeClient(json, origin(server)); var worker = new ExchangeWorker(exchange, client)) {
            worker.receive();
            worker.receive();
            assertEquals(1, requests.get());
            assertEquals(0, exchange.cursor());
            assertEquals(0, count("exchange_issues"));
        } finally { server.stop(0); }
    }

    private HttpServer source(AtomicInteger requests, AtomicReference<String> page, AtomicInteger status) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/result-events", request -> {
            requests.incrementAndGet();
            byte[] body = page.get().getBytes(StandardCharsets.UTF_8);
            request.getResponseHeaders().add("Content-Type", "application/json");
            request.sendResponseHeaders(status.get(), body.length);
            try (var output = request.getResponseBody()) { output.write(body); }
        });
        server.start();
        return server;
    }

    private URI origin(HttpServer server) { return URI.create("http://127.0.0.1:" + server.getAddress().getPort()); }
}
