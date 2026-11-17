package com.azhukov.integration.exchange;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.client.http.HttpExternalExchangeClient;
import com.azhukov.integration.config.ExchangeHttpConfiguration;
import com.azhukov.integration.config.ExchangeHttpProperties;
import com.azhukov.integration.service.ExchangeCoordinator;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.util.unit.DataSize;

class ResultFeedTest extends PostgresTest {
    @Autowired ExchangeService exchange;
    @MockitoSpyBean JdbcTemplate observedSql;

    @Test
    void recurrentInvalidPageRemainsVisibleInTheOpenOperatorRegistry() throws Exception {
        var original = "[{\"cursor\":2},{\"cursor\":1}]";
        var page = new AtomicReference<>(original);
        var server = source(new AtomicInteger(), page, new AtomicInteger(200));
        try (var http = transport(server)) {
            var client = new HttpExternalExchangeClient(http, json, settings(server));
            try (var worker = new ExchangeCoordinator(exchange, client, 8)) {
                worker.receive();
                assertTrue(worker.diagnostics().paused());
            }
            var id = jdbc.queryForObject("SELECT id FROM exchange_issues WHERE status='OPEN'", java.util.UUID.class);
            var op = login("operator");
            var resolution =
                    mvc.perform(
                                    org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                                                    "/api/exchange/issues/" + id + "/resolve")
                                            .session(op.session())
                                            .header("X-CSRF-TOKEN", op.csrf())
                                            .header("Idempotency-Key", java.util.UUID.randomUUID())
                                            .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                                            .content(
                                                    "{\"expectedIssueRevision\":1,\"action\":\"ACKNOWLEDGE_FEED_ISSUE\",\"reason\":\"Источник исправлен\"}"))
                            .andReturn();
            status(200, resolution);
            page.set("[]");
            try (var restarted = new ExchangeCoordinator(exchange, client, 8)) {
                restarted.receive();
                assertFalse(restarted.diagnostics().paused());
                assertNotNull(restarted.diagnostics().lastSuccessfulRead());
                page.set(original);
                restarted.receive();
                assertTrue(restarted.diagnostics().paused());
                var open =
                        mvc.perform(
                                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                                        "/api/exchange/issues?status=OPEN")
                                                .session(op.session()))
                                .andReturn();
                status(200, open);
                assertEquals(
                        "RESOLVED",
                        jdbc.queryForObject("SELECT status FROM exchange_issues WHERE id=?", String.class, id));
                var registry = body(open);
                assertEquals(
                        1,
                        registry.get("totalItems").asInt(),
                        "A new stop after a successful read must be visible in the operator's open registry");
                assertNotEquals(id.toString(), registry.get("items").get(0).get("issueId").asString());
                assertEquals(
                        "Источник исправлен",
                        jdbc.queryForObject(
                                "SELECT resolution->>'reason' FROM exchange_issues WHERE id=?", String.class, id));
                assertEquals(0, exchange.cursor());
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void aPublishedResultAfterAnEmptyReadIsConsumedOnTheNextSchedulerTrigger() throws Exception {
        var task = created(login("initiator.one"), java.util.UUID.randomUUID());
        var operation = jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", java.util.UUID.class, task);
        var requests = new AtomicInteger();
        var page = new AtomicReference<>("[]");
        var server = source(requests, page, new AtomicInteger(200));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            worker.receive();
            assertEquals(0, exchange.cursor());
            page.set(
                    json.writeValueAsString(
                            java.util.List.of(
                                    java.util.Map.of(
                                            "cursor",
                                            1,
                                            "result",
                                            java.util.Map.of(
                                                    "operationId",
                                                    operation,
                                                    "request",
                                                    java.util.Map.of("reference", "REQ-000001", "quantity", 25),
                                                    "version",
                                                    2,
                                                    "status",
                                                    "SUCCEEDED",
                                                    "completedAt",
                                                    java.time.Instant.now().toString())))));
            worker.receive();
            assertEquals(2, requests.get(), "A successful empty read must leave normal pacing to the scheduler");
            assertEquals(1, exchange.cursor());
            assertEquals(
                    "SUCCEEDED",
                    jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, task));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void emptyFeedUsesTheSchedulerCadenceWithoutWritingTheCursor() throws Exception {
        var requests = new AtomicInteger();
        var server = source(requests, new AtomicReference<>("[]"), new AtomicInteger(200));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            clearInvocations(observedSql);
            worker.receive();
            worker.receive();
            assertEquals(2, requests.get(), "The scheduler bounds normal reads, including empty pages");
            long writes =
                    mockingDetails(observedSql).getInvocations().stream()
                            .filter(call ->
                                    call.getMethod().getName().equals("update")
                                            && call.getArguments().length > 0
                                            && call.getArguments()[0] instanceof String sql
                                            && sql.startsWith("UPDATE incoming_position"))
                            .count();
            assertEquals(0, writes, "An empty page must not start cursor/result application");
            assertEquals(0, exchange.cursor());
            assertNotNull(worker.diagnostics().lastSuccessfulRead());
            assertFalse(worker.diagnostics().paused());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void invalidCursorPausesWithoutAdvancingAndRestartCanConsumeCorrectedSource() throws Exception {
        jdbc.update("UPDATE incoming_position SET last_cursor = 7 WHERE id = 1");
        var requests = new AtomicInteger();
        var page = new AtomicReference<>("[{\"cursor\":8},{\"cursor\":7}]");
        var server = source(requests, page, new AtomicInteger(200));
        try (var http = transport(server)) {
            var client = new HttpExternalExchangeClient(http, json, settings(server));
            try (var worker = new ExchangeCoordinator(exchange, client, 8)) {
                worker.receive();
                worker.receive();
                assertEquals(1, requests.get(), "A bad cursor must pause the consumer");
                assertEquals(7, exchange.cursor());
                assertEquals(1, count("exchange_issues"));
                assertEquals(0, count("task_history"));
                assertTrue(worker.diagnostics().paused());
                assertEquals(1, worker.diagnostics().invalidPages());
            }
            // A valid cursor with an invalid result is diagnosed and consumed, rather than poisoning the feed.
            page.set("[{\"cursor\":8,\"result\":null}]");
            try (var restarted = new ExchangeCoordinator(exchange, client, 8)) {
                restarted.receive();
                assertEquals(2, requests.get());
                assertEquals(8, exchange.cursor());
                assertEquals(2, count("exchange_issues"));
                assertEquals(
                        2,
                        jdbc.queryForObject(
                                "SELECT count(*) FROM exchange_issues WHERE task_id IS NULL AND status = 'OPEN'",
                                Integer.class));
            }
        } finally {
            server.stop(0);
        }
    }

    @Test
    void temporaryFeedFailureDoesNotAdvanceOrSpin() throws Exception {
        var requests = new AtomicInteger();
        var server = source(requests, new AtomicReference<>("{}"), new AtomicInteger(503));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            worker.receive();
            worker.receive();
            assertEquals(1, requests.get());
            assertEquals(0, exchange.cursor());
            assertEquals(0, count("exchange_issues"));
            assertEquals(1, worker.diagnostics().unavailableReads());
            assertNull(worker.diagnostics().lastSuccessfulRead());
            assertFalse(worker.diagnostics().paused());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void restartReusesTheOpenFeedPauseAndPreservesItsFirstEvidence() throws Exception {
        var page =
                new AtomicReference<>(
                        """
                        [{"cursor":2},{"cursor":1}]
                        """);
        exchange.badPage(json.readTree(page.get()));
        assertEquals(1, count("exchange_issues"));
        var first = jdbc.queryForObject("SELECT evidence::text FROM exchange_issues", String.class);
        var server = source(new AtomicInteger(), page, new AtomicInteger(200));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            worker.receive();
            assertEquals(1, count("exchange_issues"));
            assertEquals(first, jdbc.queryForObject("SELECT evidence::text FROM exchange_issues", String.class));
            assertTrue(worker.diagnostics().paused());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void classifiedResultsKeepHistoricalFingerprintsAndDoNotBlockTheNextValidEvent() throws Exception {
        var owner = login("initiator.one");
        var task = created(owner, java.util.UUID.randomUUID());
        var neighbor = created(owner, java.util.UUID.randomUUID());
        var operation = jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", java.util.UUID.class, task);
        var nextOperation =
                jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", java.util.UUID.class, neighbor);
        var valid =
                json.createObjectNode()
                        .put("operationId", operation.toString())
                        .set("request", json.createObjectNode().put("reference", "REQ-000001").put("quantity", 25))
                        .put("version", 2)
                        .put("status", "SUCCEEDED")
                        .put("completedAt", "2026-11-12T00:00:00Z");
        var badVersion = valid.deepCopy().put("version", 3);
        var badStatus = valid.deepCopy().put("status", "private-value");
        String canonical = "Входящий снимок не соответствует контракту";
        assertTrue(
                exchange.consume(
                        0,
                        java.util.List.of(
                                new com.azhukov.integration.client.ExternalExchangeClient.IncomingEvent(
                                        1, operation, null, badVersion))));
        var historical = jdbc.queryForObject("SELECT evidence::text FROM exchange_issues", String.class);
        var goodNeighbor = valid.deepCopy().put("operationId", nextOperation.toString());
        var page =
                new AtomicReference<>(
                        json.writeValueAsString(
                                json.createArrayNode()
                                        .add(json.createObjectNode().put("cursor", 2).set("result", badVersion))
                                        .add(json.createObjectNode().put("cursor", 3).set("result", badStatus))
                                        .add(json.createObjectNode().put("cursor", 4).set("result", goodNeighbor))));
        var server = source(new AtomicInteger(), page, new AtomicInteger(200));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            worker.receive();
            assertEquals(4, exchange.cursor());
            assertEquals(2, count("exchange_issues"));
            var versionFingerprint =
                    com.azhukov.integration.json.ContentFingerprint.of(json, java.util.List.of(canonical, badVersion));
            var statusFingerprint =
                    com.azhukov.integration.json.ContentFingerprint.of(json, java.util.List.of(canonical, badStatus));
            assertEquals(
                    historical,
                    jdbc.queryForObject(
                            "SELECT evidence::text FROM exchange_issues WHERE fingerprint=?",
                            String.class,
                            versionFingerprint));
            var evidence =
                    json.readTree(
                            jdbc.queryForObject(
                                    "SELECT evidence::text FROM exchange_issues WHERE fingerprint=?",
                                    String.class,
                                    statusFingerprint));
            assertEquals(canonical + " [INVALID_STATUS at status]", evidence.get("reason").asString());
            assertEquals(
                    canonical,
                    jdbc.queryForObject(
                            "SELECT summary FROM exchange_issues WHERE fingerprint=?",
                            String.class,
                            statusFingerprint));
            assertEquals(
                    "PENDING", jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, task));
            assertEquals(
                    "SUCCEEDED",
                    jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, neighbor));
            assertEquals(
                    goodNeighbor,
                    json.readTree(
                            jdbc.queryForObject(
                                    "SELECT accepted_result::text FROM tasks WHERE id=?", String.class, neighbor)));
            var history = count("task_history");
            page.set(
                    json.writeValueAsString(
                            json.createArrayNode()
                                    .add(json.createObjectNode().put("cursor", 5).set("result", badVersion))
                                    .add(json.createObjectNode().put("cursor", 6).set("result", badStatus))
                                    .add(json.createObjectNode().put("cursor", 7).set("result", goodNeighbor))));
            worker.receive();
            assertEquals(7, exchange.cursor());
            assertEquals(2, count("exchange_issues"));
            assertEquals(history, count("task_history"));
            assertEquals(2, count("command_receipts"));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void unsupportedExternalDateCreatesOneIssueWithoutBlockingAValidNeighbor() throws Exception {
        var owner = login("initiator.one");
        var badTask = created(owner, java.util.UUID.randomUUID());
        var goodTask = created(owner, java.util.UUID.randomUUID());
        var badOperation =
                jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", java.util.UUID.class, badTask);
        var goodOperation =
                jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", java.util.UUID.class, goodTask);
        var bad =
                json.createObjectNode()
                        .put("operationId", badOperation.toString())
                        .set("request", json.createObjectNode().put("reference", "REQ-000001").put("quantity", 25))
                        .put("version", 2)
                        .put("status", "SUCCEEDED")
                        .put("completedAt", "+10000-01-01T00:00:00Z");
        var good =
                bad.deepCopy().put("operationId", goodOperation.toString()).put("completedAt", "2026-11-12T00:00:00Z");
        var page =
                new AtomicReference<>(
                        json.writeValueAsString(
                                json.createArrayNode()
                                        .add(json.createObjectNode().put("cursor", 1).set("result", bad))
                                        .add(json.createObjectNode().put("cursor", 2).set("result", good))));
        var server = source(new AtomicInteger(), page, new AtomicInteger(200));
        try (var http = transport(server);
                var worker =
                        new ExchangeCoordinator(
                                exchange, new HttpExternalExchangeClient(http, json, settings(server)), 8)) {
            worker.receive();
            assertEquals(2, exchange.cursor());
            assertEquals(1, count("exchange_issues"));
            assertEquals(
                    "PENDING",
                    jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, badTask));
            assertNull(
                    jdbc.queryForObject("SELECT accepted_result::text FROM tasks WHERE id=?", String.class, badTask));
            assertEquals(
                    "SUCCEEDED",
                    jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?", String.class, goodTask));
            assertTrue(
                    jdbc.queryForObject("SELECT evidence::text FROM exchange_issues", String.class)
                            .contains("INVALID_UTC at completedAt"));
            var history = count("task_history");
            page.set(
                    json.writeValueAsString(
                            json.createArrayNode()
                                    .add(json.createObjectNode().put("cursor", 3).set("result", bad))
                                    .add(json.createObjectNode().put("cursor", 4).set("result", good))));
            worker.receive();
            assertEquals(4, exchange.cursor());
            assertEquals(1, count("exchange_issues"));
            assertEquals(history, count("task_history"));
        } finally {
            server.stop(0);
        }
    }

    private static ExchangeHttpProperties settings(HttpServer server) {
        return new ExchangeHttpProperties(
                origin(server), Duration.ofSeconds(1), Duration.ofSeconds(2), DataSize.ofKilobytes(256));
    }

    private static HttpClient transport(HttpServer server) {
        return new ExchangeHttpConfiguration().exchangeHttpClient(settings(server));
    }

    private HttpServer source(AtomicInteger requests, AtomicReference<String> page, AtomicInteger status)
            throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/result-events",
                request -> {
                    requests.incrementAndGet();
                    byte[] body = page.get().getBytes(StandardCharsets.UTF_8);
                    request.getResponseHeaders().add("Content-Type", "application/json");
                    request.sendResponseHeaders(status.get(), body.length);
                    try (var output = request.getResponseBody()) {
                        output.write(body);
                    }
                });
        server.start();
        return server;
    }

    private static URI origin(HttpServer server) {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }
}
