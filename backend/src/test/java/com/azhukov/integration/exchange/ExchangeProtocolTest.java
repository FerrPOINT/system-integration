package com.azhukov.integration.exchange;

import com.azhukov.integration.contract.ExchangeProtocol;
import com.azhukov.integration.contract.external.model.OperationInput;
import com.azhukov.integration.contract.external.model.Result;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ExchangeProtocolTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final ExchangeProtocol protocol = new ExchangeProtocol(json);
    private final String result = """
        {"operationId":"00000000-0000-4000-8000-000000000001","request":{"reference":"REQ-000001","quantity":25},
        "version":2,"status":"SUCCEEDED","completedAt":"2026-11-12T00:00:00Z"}
        """;
    private final ExchangeProtocol.Identity identity = new ExchangeProtocol.Identity(
        UUID.fromString("00000000-0000-4000-8000-000000000001"),new OperationInput("REQ-000001",25));

    @Test
    void validatesConditionalResultRulesAndImmutableInput() {
        assertEquals(Result.StatusEnum.SUCCEEDED,protocol.result(json.readTree(result)).getStatus());
        for (String invalid : new String[]{result.replace("\"version\":2","\"version\":1"),
            result.replace("SUCCEEDED","RUNNING"), result.replace("SUCCEEDED","REJECTED"),
            result.replace("\"quantity\":25","\"quantity\":25.0"),
            result.replace("00000000-0000-4000-8000-000000000001","0-0-4000-8000-1"),
            result.replace("2026-11-12T00:00:00Z","2026-11-12T03:00:00+03:00"),
            result.replace("\"version\":2","\"extra\":true,\"version\":2")}) {
            assertThrows(IllegalArgumentException.class,() -> protocol.result(json.readTree(invalid)));
        }
        var rejected = result.replace("SUCCEEDED","REJECTED").replace("\"version\":2","\"rejectionCode\":\"QUANTITY_LIMIT_EXCEEDED\",\"version\":2");
        assertEquals("QUANTITY_LIMIT_EXCEEDED",protocol.result(json.readTree(rejected)).getRejectionCode());
    }

    @Test
    void stateChecksNestedIdentityAndExecutionCount() {
        String state = """
            {"operationId":"00000000-0000-4000-8000-000000000001","request":{"reference":"REQ-000001","quantity":25},
            "acceptedAt":"2026-11-11T00:00:00Z","executions":1,"result":%s}
            """.formatted(result);
        assertInstanceOf(Result.class,protocol.state(json.readTree(state),identity).getResult());
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(state.replace("\"executions\":1","\"executions\":0")),identity));
        var changedResult = state.replace("\"result\":" + result,"\"result\":" + result.replace("\"quantity\":25","\"quantity\":26"));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(changedResult),identity));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(state.replace("\"result\":" + result,"\"result\":null")),identity));
    }

    @Test
    void cursorValidationIsStrictWithoutRejectingASnapshotWithBadContent() {
        assertTrue(ExchangeWorker.validPage(json.readTree("[{\"cursor\":11,\"result\":null}]"),10));
        for (String page : new String[]{"{}","[{\"cursor\":10}]","[{\"cursor\":11},{\"cursor\":11}]",
            "[{\"cursor\":11.0}]","[{\"cursor\":9007199254740992}]"}) {
            assertFalse(ExchangeWorker.validPage(json.readTree(page),10));
        }
    }

    @Test
    void missingOperationRequiresTheWholeProblemContract() {
        var valid=json.readTree("{\"title\":\"Отсутствует\",\"status\":404,\"code\":\"OPERATION_NOT_FOUND\"}");
        assertTrue(ExchangeProtocol.missingOperation(404,valid));
        assertFalse(ExchangeProtocol.missingOperation(500,valid));
        assertFalse(ExchangeProtocol.missingOperation(404,json.readTree("{\"code\":\"OPERATION_NOT_FOUND\"}")));
        assertFalse(ExchangeProtocol.missingOperation(404,json.readTree("{\"title\":\"Ошибка\",\"status\":500,\"code\":\"OPERATION_NOT_FOUND\"}")));
        assertFalse(ExchangeProtocol.missingOperation(404,json.readTree("{\"title\":\"Ошибка\",\"status\":4294967700,\"code\":\"OPERATION_NOT_FOUND\"}")));
    }
}
