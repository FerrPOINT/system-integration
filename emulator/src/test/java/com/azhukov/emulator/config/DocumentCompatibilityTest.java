package com.azhukov.emulator.config;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.emulator.domain.OperationResult;
import com.azhukov.integration.contract.external.model.Result;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class DocumentCompatibilityTest {
    @Test
    void storedResultsPreserveTheGeneratedHistoricalJsonForAllThreeVariants() {
        var builder = JsonMapper.builder();
        new DocumentJsonConfiguration().documents().customize(builder);
        var json = builder.build();
        for (String fields :
                new String[] {
                    "\"version\":1,\"status\":\"RUNNING\"",
                    "\"version\":2,\"status\":\"SUCCEEDED\",\"completedAt\":\"2026-11-12T00:00:00.123456789Z\"",
                    "\"version\":2,\"status\":\"REJECTED\",\"completedAt\":\"2026-11-12T00:00:00Z\",\"rejectionCode\":\"QUANTITY_LIMIT_EXCEEDED\""
                }) {
            var document =
                    json.readTree(
                            """
                            {"operationId":"00000000-0000-4000-8000-000000000001","request":{"reference":"REQ-000001","quantity":25},%s}
                            """
                                    .formatted(fields));
            var legacy = json.treeToValue(document, Result.class);
            var current = json.treeToValue(document, OperationResult.class);
            assertEquals(
                    json.readTree(json.writeValueAsString(legacy)), json.readTree(json.writeValueAsString(current)));
            assertEquals(current, json.readValue(json.writeValueAsString(current), OperationResult.class));
        }
    }
}
