package com.azhukov.integration.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.azhukov.integration.contract.external.model.Acknowledgement;
import com.azhukov.integration.contract.external.model.OperationState;
import com.azhukov.integration.contract.external.model.Result;
import com.azhukov.integration.contract.internal.api.SessionApi;
import com.azhukov.integration.contract.internal.model.CsrfToken;
import com.azhukov.integration.contract.internal.model.Issue;
import com.azhukov.integration.contract.internal.model.Session;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

class GeneratedContractTest {

    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void springBindsRouteFromGeneratedInterface() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new SessionFixture()).build();

        var response = mvc.perform(get("/api/csrf")).andReturn().getResponse();

        assertEquals(200, response.getStatus());
        assertEquals("test-token", json.readTree(response.getContentAsString()).get("token").asString());
    }

    @Test
    void exchangeDtosPreserveRequiredNullAndOmitAbsentRejectionCode() {
        var accepted =
                json.readValue(
                        """
                        {
                          "operationId": "40ad5299-2e09-4d7f-9a14-f02ca60f55ef",
                          "request": {"reference": "REQ-123456", "quantity": 25},
                          "acceptedAt": "2026-11-11T00:00:00Z",
                          "executions": 0,
                          "result": null
                        }
                        """,
                        OperationState.class);
        var succeeded =
                json.readValue(
                        """
                        {
                          "operationId": "40ad5299-2e09-4d7f-9a14-f02ca60f55ef",
                          "request": {"reference": "REQ-123456", "quantity": 25},
                          "version": 2,
                          "status": "SUCCEEDED",
                          "completedAt": "2026-11-11T00:00:01Z"
                        }
                        """,
                        Result.class);
        var acknowledgement =
                json.readValue(
                        """
                        {
                          "operationId": "40ad5299-2e09-4d7f-9a14-f02ca60f55ef",
                          "request": {"reference": "REQ-123456", "quantity": 25},
                          "acceptedAt": "2026-11-11T00:00:00Z"
                        }
                        """,
                        Acknowledgement.class);

        assertTrue(json.valueToTree(accepted).get("result").isNull());
        assertEquals(25, json.valueToTree(accepted).get("request").get("quantity").intValue());
        var result = json.valueToTree(succeeded);
        assertEquals(2, result.get("version").intValue());
        assertEquals("SUCCEEDED", result.get("status").asString());
        assertEquals(25, result.get("request").get("quantity").intValue());
        assertEquals("REQ-123456", json.valueToTree(acknowledgement).at("/request/reference").asString());
        assertEquals("2026-11-11T00:00:01Z", result.get("completedAt").asString());
        assertFalse(result.has("rejectionCode"));
    }

    @Test
    void issuePreservesDiagnosticSnapshotsAndResponsibility() {
        var issue =
                json.readValue(
                        """
                        {
                          "issueId": "40ad5299-2e09-4d7f-9a14-f02ca60f55ef",
                          "issueRevision": 2,
                          "kind": "RESULT_CONFLICT",
                          "status": "OPEN",
                          "openedAt": "2026-11-12T00:00:00Z",
                          "summary": "Conflicting result",
                          "allowedActions": ["TAKE_OWNERSHIP", "RECONCILE"],
                          "assignedTo": "edb34775-b3b8-4de7-816f-58312ed93c9b",
                          "evidence": {
                            "reason": "Different content for the same version",
                            "cursor": 12,
                            "local": {
                              "request": {"reference": "REQ-123456", "quantity": 25},
                              "deliveryStatus": "ACKNOWLEDGED",
                              "businessStatus": "SUCCEEDED",
                              "resultVersion": 2,
                              "result": {"status": "SUCCEEDED", "completedAt": "2026-11-12T00:00:00Z"}
                            },
                            "received": {
                              "operationId": "40ad5299-2e09-4d7f-9a14-f02ca60f55ef",
                              "request": {"reference": "REQ-123456", "quantity": 25},
                              "version": 2,
                              "status": "REJECTED",
                              "rejectionCode": "QUANTITY_LIMIT_EXCEEDED",
                              "completedAt": "2026-11-12T00:00:00Z"
                            }
                          }
                        }
                        """,
                        Issue.class);

        var saved = json.valueToTree(issue);
        assertEquals("edb34775-b3b8-4de7-816f-58312ed93c9b", saved.get("assignedTo").asString());
        assertEquals("SUCCEEDED", saved.at("/evidence/local/result/status").asString());
        assertEquals("REJECTED", saved.at("/evidence/received/status").asString());
        assertEquals(25, saved.at("/evidence/received/request/quantity").intValue());
        assertEquals(12, saved.at("/evidence/cursor").intValue());
    }

    @RestController
    static class SessionFixture implements SessionApi {

        @Override
        public ResponseEntity<CsrfToken> getCsrfToken() {
            return ResponseEntity.ok(new CsrfToken("test-token"));
        }

        @Override
        public ResponseEntity<Session> getSession() {
            return ResponseEntity.noContent().build();
        }
    }
}
