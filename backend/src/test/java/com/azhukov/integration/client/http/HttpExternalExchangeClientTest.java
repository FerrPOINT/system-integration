package com.azhukov.integration.client.http;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.config.ExchangeHttpConfiguration;
import com.azhukov.integration.config.ExchangeHttpProperties;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;
import tools.jackson.databind.json.JsonMapper;

class HttpExternalExchangeClientTest {
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
        try (var source =
                        source(request -> {
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
                                try {
                                    release.await(10, TimeUnit.SECONDS);
                                } catch (InterruptedException interrupted) {
                                    Thread.currentThread().interrupt();
                                }
                            }
                        });
                var http = transport(source.origin())) {
            var client = new HttpExternalExchangeClient(http, json, settings(source.origin()));
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
                assertTimeoutPreemptively(Duration.ofSeconds(1), http::close);
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void completeJsonResponseRetainsStatusAndBody() throws Exception {
        try (var source = source(HttpExternalExchangeClientTest::reply);
                var http = transport(source.origin())) {
            var client = new HttpExternalExchangeClient(http, json, settings(source.origin()));
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
        URI origin = URI.create("http://127.0.0.1:" + port);
        try (var http = transport(origin)) {
            var client = new HttpExternalExchangeClient(http, json, settings(origin));
            var result = client.get(UUID.randomUUID());
            assertEquals(0, result.status());
            assertNull(result.body());
            assertTrue(result.connectionFailed());
        }
    }

    @Test
    void reconciliationLookupClassifiesHttpRepliesWithoutConcealingProtocolErrors() throws Exception {
        UUID id = UUID.randomUUID();
        String snapshot =
                """
                {"operationId":"%s","request":{"reference":"REQ-000002","quantity":26},
                 "acceptedAt":"2026-11-12T00:00:00Z","executions":0,"result":null}
                """
                        .formatted(id);
        String missing =
                """
                {"title":"Отсутствует","status":404,"code":"OPERATION_NOT_FOUND"}
                """;
        record Case(int status, String body, String availability, boolean protocolError) {}
        for (var probe :
                java.util.List.of(
                        new Case(200, snapshot, "PRESENT", false),
                        new Case(200, "{}", "UNAVAILABLE", true),
                        new Case(404, missing, "NOT_FOUND", false),
                        new Case(404, "{}", "UNAVAILABLE", true),
                        new Case(400, "{}", "UNAVAILABLE", true),
                        new Case(503, "{}", "UNAVAILABLE", false),
                        new Case(302, "{}", "UNAVAILABLE", false))) {
            try (var source =
                            source(request -> {
                                byte[] body = probe.body().getBytes(StandardCharsets.UTF_8);
                                request.getResponseHeaders().add("Content-Type", "application/json");
                                request.sendResponseHeaders(probe.status(), body.length);
                                try (var output = request.getResponseBody()) {
                                    output.write(body);
                                }
                            });
                    var http = transport(source.origin())) {
                var client = new HttpExternalExchangeClient(http, json, settings(source.origin()));
                var result = client.lookup(id);
                assertEquals(probe.availability(), result.availability().name(), probe.toString());
                assertEquals(probe.protocolError(), result.protocolFailure() != null, probe.toString());
                if (result.external() != null) {
                    assertEquals(
                            26,
                            result.external().request().quantity(),
                            "Operator must see external differences unchanged");
                    assertNull(result.external().result());
                }
                Object original =
                        result.evidence()
                                        instanceof
                                        com.azhukov.integration.client.ExternalExchangeClient.ProtocolEvidence detail
                                ? detail.content()
                                : result.evidence();
                assertEquals(json.readTree(probe.body()), original);
            }
        }
    }

    @Test
    void oversizedRepliesRemainProtocolFailuresForFixedAndChunkedResponses() throws Exception {
        UUID good = UUID.randomUUID();
        UUID large = UUID.randomUUID();
        for (boolean chunked : new boolean[] {false, true}) {
            for (int status : new int[] {200, 503}) {
                try (var source =
                                source(request -> {
                                    if (request.getRequestURI().getPath().endsWith(good.toString())) {
                                        reply(request);
                                        return;
                                    }
                                    byte[] payload =
                                            ("{\"value\":\"" + "x".repeat(8192) + "\"}")
                                                    .getBytes(StandardCharsets.UTF_8);
                                    request.sendResponseHeaders(status, chunked ? 0 : payload.length);
                                    try (var output = request.getResponseBody()) {
                                        output.write(payload);
                                    } catch (IOException cancelled) {
                                        request.close();
                                    }
                                });
                        var http = transport(source.origin())) {
                    var config =
                            new ExchangeHttpProperties(
                                    source.origin(),
                                    Duration.ofSeconds(1),
                                    Duration.ofSeconds(2),
                                    DataSize.ofBytes(64));
                    var client = new HttpExternalExchangeClient(http, json, config);
                    var raw = client.get(large);
                    assertEquals(status, raw.status());
                    assertNull(raw.body());
                    assertNotNull(raw.protocolFailure());
                    var attempt =
                            new com.azhukov.integration.domain.exchange.DeliveryAttempt(
                                    large,
                                    UUID.randomUUID(),
                                    "PUT",
                                    1,
                                    1,
                                    new com.azhukov.integration.domain.task.TaskInput("REQ-999999", 25));
                    assertEquals(
                            com.azhukov.integration.domain.exchange.DeliveryAttempt.Outcome.PROTOCOL_ERROR,
                            client.deliver(attempt).outcome());
                    assertNotNull(client.lookup(large).protocolFailure());
                    assertEquals(
                            com.azhukov.integration.client.ExternalExchangeClient.FeedStatus.INVALID_PAGE,
                            client.events(0).status());
                    assertEquals(
                            42,
                            client.get(good).body().get("value").asInt(),
                            "Cancellation must not poison the next request");
                    assertTimeoutPreemptively(Duration.ofSeconds(1), http::close);
                }
            }
        }
    }

    @Test
    void defaultLimitAcceptsAFullPageOfMaximumNormalResults() throws Exception {
        var page = json.createArrayNode();
        for (int n = 0; n < 100; n++) {
            var event = page.addObject().put("cursor", 9007199254740892L + n);
            event.putObject("result")
                    .put("operationId", UUID.randomUUID().toString())
                    .put("version", 2)
                    .put("status", "REJECTED")
                    .put("completedAt", "9999-12-31T23:59:59.999999999Z")
                    .put("rejectionCode", "QUANTITY_LIMIT_EXCEEDED")
                    .putObject("request")
                    .put("reference", "REQ-999999")
                    .put("quantity", 1000);
        }
        byte[] payload = json.writeValueAsBytes(page);
        assertTrue(payload.length < DataSize.ofKilobytes(256).toBytes());
        try (var source =
                        source(request -> {
                            request.getResponseHeaders().add("Content-Type", "application/json");
                            request.sendResponseHeaders(200, payload.length);
                            try (var output = request.getResponseBody()) {
                                output.write(payload);
                            }
                        });
                var http = transport(source.origin())) {
            var client = new HttpExternalExchangeClient(http, json, settings(source.origin()));
            var result = client.events(0);
            assertEquals(com.azhukov.integration.client.ExternalExchangeClient.FeedStatus.READY, result.status());
            assertEquals(100, result.events().size());
            assertTrue(result.events().stream().allMatch(event -> event.result() != null));
        }
    }

    @Test
    void versionAndStatusDiagnosticsSurviveHttpForLookupDeliveryAndFeed() throws Exception {
        var id = UUID.randomUUID();
        var result =
                json.createObjectNode()
                        .put("operationId", id.toString())
                        .set("request", json.createObjectNode().put("reference", "REQ-000001").put("quantity", 25))
                        .put("version", 2)
                        .put("status", "SUCCEEDED")
                        .put("completedAt", "2026-11-12T00:00:00Z");
        record Case(tools.jackson.databind.node.ObjectNode result, String detail) {}
        for (var probe :
                java.util.List.of(
                        new Case(result.deepCopy().put("version", 3), "UNSUPPORTED_VERSION at version"),
                        new Case(result.deepCopy().put("status", "private-value"), "INVALID_STATUS at status"),
                        new Case(result.deepCopy().put("status", "PENDING"), "INVALID_STATUS at status"))) {
            var current = new java.util.concurrent.atomic.AtomicReference<>(probe.result());
            var requests = new java.util.concurrent.atomic.AtomicInteger();
            try (var source =
                            source(request -> {
                                requests.incrementAndGet();
                                var snapshot =
                                        json.createObjectNode()
                                                .put("operationId", id.toString())
                                                .set("request", result.get("request"))
                                                .put("acceptedAt", "2026-11-11T00:00:00Z")
                                                .put("executions", 1)
                                                .set("result", current.get());
                                var page =
                                        json.createArrayNode()
                                                .add(
                                                        json.createObjectNode()
                                                                .put("cursor", 1)
                                                                .set("result", current.get()));
                                byte[] body =
                                        json.writeValueAsBytes(
                                                request.getRequestURI().getPath().equals("/result-events")
                                                        ? page
                                                        : snapshot);
                                request.getResponseHeaders().add("Content-Type", "application/json");
                                request.sendResponseHeaders(200, body.length);
                                try (var output = request.getResponseBody()) {
                                    output.write(body);
                                }
                            });
                    var http = transport(source.origin())) {
                var client = new HttpExternalExchangeClient(http, json, settings(source.origin()));
                var attempt =
                        new com.azhukov.integration.domain.exchange.DeliveryAttempt(
                                id,
                                UUID.randomUUID(),
                                "GET",
                                1,
                                1,
                                new com.azhukov.integration.domain.task.TaskInput("REQ-000001", 25));
                var lookup = client.lookup(id);
                assertEquals("UNAVAILABLE", lookup.availability().name());
                assertNull(lookup.external());
                assertEquals("Сверка получила некорректный внешний снимок", lookup.protocolFailure());
                var delivery = client.deliver(attempt);
                assertEquals(
                        com.azhukov.integration.domain.exchange.DeliveryAttempt.Outcome.PROTOCOL_ERROR,
                        delivery.outcome());
                var feed = client.events(0);
                assertEquals(com.azhukov.integration.client.ExternalExchangeClient.FeedStatus.READY, feed.status());
                assertNull(feed.events().getFirst().result());
                for (Object raw :
                        java.util.List.of(
                                lookup.evidence(), delivery.evidence(), feed.events().getFirst().evidence())) {
                    var evidence =
                            assertInstanceOf(
                                    com.azhukov.integration.client.ExternalExchangeClient.ProtocolEvidence.class, raw);
                    assertEquals(probe.detail(), evidence.detail());
                    assertEquals(
                            probe.result(),
                            evidence.content() instanceof tools.jackson.databind.JsonNode node && node.has("result")
                                    ? node.get("result")
                                    : evidence.content());
                }
                current.set(result);
                var accepted = client.lookup(id);
                assertEquals("PRESENT", accepted.availability().name());
                assertNull(accepted.protocolFailure());
                assertEquals("SUCCEEDED", accepted.external().result().status().name());
                assertEquals(
                        com.azhukov.integration.domain.exchange.DeliveryAttempt.Outcome.ACKNOWLEDGED,
                        client.deliver(attempt).outcome());
                assertEquals("SUCCEEDED", client.events(0).events().getFirst().result().status().name());
                assertEquals(6, requests.get());
            }
        }
    }

    private static ExchangeHttpProperties settings(URI origin) {
        return new ExchangeHttpProperties(
                origin, Duration.ofSeconds(1), Duration.ofSeconds(2), DataSize.ofKilobytes(256));
    }

    private static HttpClient transport(URI origin) {
        return new ExchangeHttpConfiguration().exchangeHttpClient(settings(origin));
    }

    private static void reply(HttpExchange request) throws IOException {
        byte[] body = "{\"value\":42}".getBytes(StandardCharsets.UTF_8);
        request.getResponseHeaders().add("Content-Type", "application/json");
        request.sendResponseHeaders(200, body.length);
        try (var output = request.getResponseBody()) {
            output.write(body);
        }
    }

    private static Source source(HttpHandler handler) throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/", handler);
        server.start();
        return new Source(server, executor);
    }

    private record Source(HttpServer server, ExecutorService executor) implements AutoCloseable {
        URI origin() {
            return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
        }

        @Override
        public void close() throws InterruptedException {
            server.stop(0);
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS), "Fixture threads must terminate");
        }
    }
}
