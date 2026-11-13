package com.azhukov.integration.config;

import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.domain.review.IssueResolution;
import com.azhukov.integration.domain.review.Reconciliation;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

class ReviewDocumentCompatibilityTest {
    private final JsonMapper json=mapper();
    private static JsonMapper mapper() {
        var builder=JsonMapper.builder();
        new DocumentJsonConfiguration().documents().customize(builder);
        return builder.build();
    }

    @Test
    void historicalSnapshotsRoundTripWithoutNullInflationOrLostTerminalFields() {
        for (String external:new String[]{"",",\"external\":{\"operationId\":\"00000000-0000-4000-8000-000000000002\",\"request\":{\"reference\":\"REQ-000001\",\"quantity\":25},\"acceptedAt\":\"2026-11-12T00:00:00Z\",\"executions\":0,\"result\":null}"}) {
            var source=json.readTree("""
                {"reconciliationId":"00000000-0000-4000-8000-000000000003",
                 "taskId":"00000000-0000-4000-8000-000000000001","operationId":"00000000-0000-4000-8000-000000000002",
                 "checkedAt":"2026-11-12T00:00:00.123456789Z","checkedBy":"00000000-0000-4000-8000-000000000004",
                 "outcome":"DIFFERENCE","local":{"request":{"reference":"REQ-000001","quantity":25},
                 "deliveryStatus":"ACKNOWLEDGED","businessStatus":"REJECTED","resultVersion":2,
                 "result":{"status":"REJECTED","completedAt":"2026-11-12T00:00:00Z","rejectionCode":"QUANTITY_LIMIT_EXCEEDED"}},
                 "externalAvailability":"%s"%s}
                """.formatted(external.isEmpty() ? "NOT_FOUND" : "PRESENT",external));
            var legacy=json.treeToValue(source,com.azhukov.integration.contract.internal.model.Reconciliation.class);
            var current=json.treeToValue(source,Reconciliation.class);
            assertEquals(json.readTree(json.writeValueAsString(legacy)),json.readTree(json.writeValueAsString(current)));
        }
    }

    @Test
    void sparseFeedEvidenceAndHistoricalResolutionRemainReadable() {
        assertEquals(json.readTree("{}"),json.readTree(json.writeValueAsString(json.readValue("{}",Evidence.class))));
        var source="""
            {"issueId":"00000000-0000-4000-8000-000000000001","issueRevision":3,"kind":"RESULT_CONFLICT","status":"OPEN",
             "openedAt":"2026-11-12T00:00:00Z","summary":"Проблема ленты","evidence":{},"allowedActions":[]}
            """;
        assertEquals(json.readTree(source),json.readTree(json.writeValueAsString(json.readValue(source,Issue.class))));
        var decision="""
            {"issueId":"00000000-0000-4000-8000-000000000001","reconciliationId":"00000000-0000-4000-8000-000000000003",
             "action":"ACKNOWLEDGE_DIFFERENCE","reason":"Проверено","decidedBy":"00000000-0000-4000-8000-000000000004",
             "decidedAt":"2026-11-12T00:00:00.123456789Z"}
            """;
        assertEquals(json.readTree(decision),json.readTree(json.writeValueAsString(json.readValue(decision,IssueResolution.class))));
    }
}
