package com.azhukov.integration.config;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.client.http.ExchangeProtocol;
import com.azhukov.integration.contract.external.model.Result;
import com.azhukov.integration.domain.exchange.OperationResult;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class ExternalDocumentCompatibilityTest {
    private JsonMapper mapper() {
        var builder = JsonMapper.builder();
        new DocumentJsonConfiguration().documents().customize(builder);
        return builder.build();
    }

    @Test
    void allThreeResultsKeepTheHistoricalWireAndStoredJson() {
        var json = mapper();
        var protocol = new ExchangeProtocol();
        var identity =
                "\"operationId\":\"00000000-0000-4000-8000-000000000001\",\"request\":{\"reference\":\"REQ-000001\",\"quantity\":25}";
        for (var fields :
                new String[] {
                    "\"version\":1,\"status\":\"RUNNING\"",
                    "\"version\":2,\"status\":\"SUCCEEDED\",\"completedAt\":\"2026-11-12T00:00:00.123456789Z\"",
                    "\"version\":2,\"status\":\"REJECTED\",\"completedAt\":\"2026-11-12T00:00:00Z\",\"rejectionCode\":\"QUANTITY_LIMIT_EXCEEDED\""
                }) {
            var expected = json.readTree("{" + identity + "," + fields + "}");
            var legacy = json.treeToValue(expected, Result.class);
            var current = protocol.result(expected);
            assertEquals(expected, json.readTree(json.writeValueAsString(current)));
            assertEquals(
                    json.convertValue(legacy, Object.class),
                    json.convertValue(current, Object.class),
                    "Canonical fingerprint input must remain equivalent to the historical DTO");
            assertEquals(current, json.readValue(json.writeValueAsString(current), OperationResult.class));
        }
    }

    @Test
    void acceptedSnapshotsKeepTheRequiredNullResult() {
        var json = mapper();
        var protocol = new ExchangeProtocol();
        var expected =
                json.readTree(
                        """
                        {"operationId":"00000000-0000-4000-8000-000000000001",
                         "request":{"reference":"REQ-000001","quantity":25},
                         "acceptedAt":"2026-11-12T00:00:00Z","executions":0,"result":null}
                        """);
        var current = protocol.state(expected);
        var encoded = json.readTree(json.writeValueAsString(current));
        assertTrue(encoded.has("result"));
        assertTrue(encoded.get("result").isNull());
        assertEquals(expected, encoded);
    }
}
