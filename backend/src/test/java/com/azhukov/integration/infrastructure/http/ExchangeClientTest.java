package com.azhukov.integration.infrastructure.http;


import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class ExchangeClientTest {
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void delayedHeadersTimeOutWithoutClaimingDefiniteConnectionFailure() throws Exception {
        assertStalledResponseTimesOut(false);
    }

    @Test
    void stalledBodyIsCancelledAndClientRemainsUsableAndClosesPromptly() throws Exception {
        assertStalledResponseTimesOut(true);
    }

    private void assertStalledResponseTimesOut(boolean partialBody) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        UUID slow = UUID.randomUUID();
        try (var source = source(request -> {
            if (!request.getRequestURI().getPath().equals("/operations/" + slow)) {
                reply(request);
                return;
            }
            try (request) {
                if (partialBody) {
                    request.sendResponseHeaders(200, 1024);
                    request.getResponseBody().write('{');
                    request.getResponseBody().flush();
                }
                entered.countDown();
                try { release.await(10, TimeUnit.SECONDS); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
        }); var client = new ExchangeClient(json, source.origin())) {
            try {
                long started = System.nanoTime();
                var result = assertTimeoutPreemptively(Duration.ofSeconds(4), () -> client.get(slow));
                assertEquals(0, entered.getCount(), "The server must actually enter the stalled response");
                assertTrue(System.nanoTime() - started >= Duration.ofMillis(1500).toNanos());
                assertEquals(0, result.status());
                assertNull(result.body());
                assertFalse(result.connectionFailed(), "A timeout has an ambiguous delivery outcome");
                assertEquals(1, release.getCount(), "The stalled server has not been released");
                var next = assertTimeoutPreemptively(Duration.ofSeconds(4), () -> client.get(UUID.randomUUID()));
                assertEquals(200, next.status());
                assertEquals(42, next.body().get("value").asInt());
                // close waits for outstanding exchanges; prompt close proves cancellation reached HTTP.
                assertTimeoutPreemptively(Duration.ofSeconds(1), client::close);
            } finally { release.countDown(); }
        }
    }

    @Test
    void completeJsonResponseRetainsStatusAndBody() throws Exception {
        try (var source = source(ExchangeClientTest::reply);
             var client = new ExchangeClient(json, source.origin())) {
            var result = client.get(UUID.randomUUID());
            assertEquals(200, result.status());
            assertEquals(42, result.body().get("value").asInt());
            assertFalse(result.connectionFailed());
        }
    }

    @Test
    void refusedConnectionIsDefiniteFailure() throws Exception {
        int port;
        try (var unused = new ServerSocket()) {
            unused.bind(new InetSocketAddress("127.0.0.1", 0));
            port = unused.getLocalPort();
        }
        try (var client = new ExchangeClient(json, URI.create("http://127.0.0.1:" + port))) {
            var result = client.get(UUID.randomUUID());
            assertEquals(0, result.status());
            assertNull(result.body());
            assertTrue(result.connectionFailed());
        }
    }

    @Test
    void reconciliationLookupClassifiesHttpRepliesWithoutConcealingProtocolErrors() throws Exception {
        UUID id=UUID.randomUUID();
        String snapshot="""
            {"operationId":"%s","request":{"reference":"REQ-000002","quantity":26},
             "acceptedAt":"2026-11-12T00:00:00Z","executions":0,"result":null}
            """.formatted(id);
        String missing="""
            {"title":"Отсутствует","status":404,"code":"OPERATION_NOT_FOUND"}
            """;
        record Case(int status,String body,String availability,boolean protocolError) {}
        for (var probe:java.util.List.of(
            new Case(200,snapshot,"PRESENT",false),new Case(200,"{}","UNAVAILABLE",true),
            new Case(404,missing,"NOT_FOUND",false),new Case(404,"{}","UNAVAILABLE",true),
            new Case(400,"{}","UNAVAILABLE",true),new Case(503,"{}","UNAVAILABLE",false),
            new Case(302,"{}","UNAVAILABLE",false))) {
            try (var source=source(request -> {
                byte[] body=probe.body().getBytes(StandardCharsets.UTF_8);
                request.getResponseHeaders().add("Content-Type","application/json");
                request.sendResponseHeaders(probe.status(),body.length);
                try (var output=request.getResponseBody()) { output.write(body); }
            }); var client=new ExchangeClient(json,source.origin())) {
                var result=client.lookup(id);
                assertEquals(probe.availability(),result.availability().name(),probe.toString());
                assertEquals(probe.protocolError(),result.protocolFailure()!=null,probe.toString());
                if (result.external()!=null) {
                    assertEquals(26,result.external().request().quantity(),"Operator must see external differences unchanged");
                    assertNull(result.external().result());
                }
                assertEquals(json.readTree(probe.body()),result.evidence());
            }
        }
    }

    private static void reply(HttpExchange request) throws IOException {
        byte[] body = "{\"value\":42}".getBytes(StandardCharsets.UTF_8);
        request.getResponseHeaders().add("Content-Type", "application/json");
        request.sendResponseHeaders(200, body.length);
        try (var output = request.getResponseBody()) { output.write(body); }
    }

    private static Source source(HttpHandler handler) throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/operations", handler);
        server.start();
        return new Source(server, executor);
    }

    private record Source(HttpServer server, ExecutorService executor) implements AutoCloseable {
        URI origin() { return URI.create("http://127.0.0.1:" + server.getAddress().getPort()); }
        @Override public void close() throws InterruptedException {
            server.stop(0);
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS), "Fixture threads must terminate");
        }
    }
}
