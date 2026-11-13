package com.azhukov.integration.infrastructure.http;

import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.exchange.OperationIdentity;
import com.azhukov.integration.domain.exchange.OperationResult;
import org.junit.jupiter.api.Test;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.application.port.ExternalExchange;
import tools.jackson.databind.json.JsonMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ExchangeProtocolTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final ExchangeProtocol protocol = new ExchangeProtocol();
    private final String result = """
        {"operationId":"00000000-0000-4000-8000-000000000001","request":{"reference":"REQ-000001","quantity":25},
        "version":2,"status":"SUCCEEDED","completedAt":"2026-11-12T00:00:00Z"}
        """;
    private final OperationIdentity identity = new OperationIdentity(
        UUID.fromString("00000000-0000-4000-8000-000000000001"),new TaskInput("REQ-000001",25));

    @Test
    void validatesConditionalResultRulesAndImmutableInput() {
        assertEquals(BusinessStatus.SUCCEEDED,protocol.result(json.readTree(result)).status());
        for (String invalid : new String[]{result.replace("\"version\":2","\"version\":1"),
            result.replace("SUCCEEDED","RUNNING"), result.replace("SUCCEEDED","REJECTED"),
            result.replace("\"quantity\":25","\"quantity\":25.0"),
            result.replace("00000000-0000-4000-8000-000000000001","0-0-4000-8000-1"),
            result.replace("2026-11-12T00:00:00Z","2026-11-12T03:00:00+03:00"),
            result.replace("\"version\":2","\"extra\":true,\"version\":2")}) {
            assertThrows(IllegalArgumentException.class,() -> protocol.result(json.readTree(invalid)));
        }
        var rejected = result.replace("SUCCEEDED","REJECTED").replace("\"version\":2","\"rejectionCode\":\"QUANTITY_LIMIT_EXCEEDED\",\"version\":2");
        assertEquals("QUANTITY_LIMIT_EXCEEDED",protocol.result(json.readTree(rejected)).rejectionCode());
    }

    @Test
    void explicitNullDoesNotBecomeAnAbsentConditionalField() {
        var succeeded = (tools.jackson.databind.node.ObjectNode) json.readTree(result);
        assertThrows(IllegalArgumentException.class,() -> protocol.result(succeeded.deepCopy().putNull("rejectionCode")));
        assertThrows(IllegalArgumentException.class,() -> protocol.result(succeeded.deepCopy().putNull("completedAt")));
        var running = succeeded.deepCopy().put("version",1).put("status","RUNNING").putNull("completedAt");
        assertThrows(IllegalArgumentException.class,() -> protocol.result(running));
    }

    @Test
    void stateChecksNestedIdentityAndExecutionCount() {
        String state = """
            {"operationId":"00000000-0000-4000-8000-000000000001","request":{"reference":"REQ-000001","quantity":25},
            "acceptedAt":"2026-11-11T00:00:00Z","executions":1,"result":%s}
            """.formatted(result);
        assertInstanceOf(OperationResult.class,protocol.state(json.readTree(state),identity).result());
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(state.replace("\"executions\":1","\"executions\":0")),identity));
        var changedResult = state.replace("\"result\":" + result,"\"result\":" + result.replace("\"quantity\":25","\"quantity\":26"));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(changedResult),identity));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(json.readTree(state.replace("\"result\":" + result,"\"result\":null")),identity));
    }

    @Test
    void cursorValidationIsStrictWithoutRejectingASnapshotWithBadContent() {
        assertTrue(ExchangeProtocol.validPage(json.readTree("[{\"cursor\":11,\"result\":null}]"),10));
        for (String page : new String[]{"{}","[{\"cursor\":10}]","[{\"cursor\":11},{\"cursor\":11}]",
            "[{\"cursor\":11.0}]","[{\"cursor\":9007199254740992}]"}) {
            assertFalse(ExchangeProtocol.validPage(json.readTree(page),10));
        }
    }

    @Test
    void allResultStateCombinationsFollowTheThreeDeclaredVariants() {
        var allowed=java.util.Set.of("1:RUNNING:false:false","2:SUCCEEDED:true:false","2:REJECTED:true:true");
        for (int version=0;version<=3;version++) {
            for (String status:new String[]{"RUNNING","SUCCEEDED","REJECTED","PENDING","UNKNOWN"}) {
                for (boolean completed:new boolean[]{false,true}) {
                    for (boolean rejection:new boolean[]{false,true}) {
                        var body=json.createObjectNode().put("operationId",identity.id().toString())
                            .set("request",json.valueToTree(identity.request())).put("version",version).put("status",status);
                        if (completed) body.put("completedAt","2026-11-12T00:00:00Z");
                        if (rejection) body.put("rejectionCode","QUANTITY_LIMIT_EXCEEDED");
                        String variant=version+":"+status+":"+completed+":"+rejection;
                        if (allowed.contains(variant)) assertDoesNotThrow(() -> protocol.result(body),variant);
                        else assertThrows(IllegalArgumentException.class,() -> protocol.result(body),variant);
                    }
                }
            }
        }
    }

    @Test
    void acceptedStateAllowsNullOrRunningBeforeExecutionButOnlyTerminalAfterIt() {
        var base=json.createObjectNode().put("operationId",identity.id().toString())
            .set("request",json.valueToTree(identity.request())).put("acceptedAt","2026-11-11T00:00:00Z");
        var running=json.createObjectNode().put("operationId",identity.id().toString())
            .set("request",json.valueToTree(identity.request())).put("version",1).put("status","RUNNING");
        var empty=base.deepCopy().put("executions",0).putNull("result");
        assertEquals(0,protocol.state(empty).executions());
        var active=base.deepCopy().put("executions",0).set("result",running);
        assertEquals(BusinessStatus.RUNNING,((OperationResult)protocol.state(active).result()).status());
        assertThrows(IllegalArgumentException.class,() -> protocol.state(base.deepCopy().put("executions",0)));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(base.deepCopy().put("executions",1).set("result",running)));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(base.deepCopy().put("executions",2).set("result",json.readTree(result))));
        assertThrows(IllegalArgumentException.class,() -> protocol.state(base.deepCopy().put("executions",0).put("result","")));
    }

    @Test
    void deliveryReplySeparatesValidConfirmationMissingOperationAndProtocolFailures() {
        var ack=(tools.jackson.databind.node.ObjectNode)json.readTree("""
            {"operationId":"00000000-0000-4000-8000-000000000001",
             "request":{"reference":"REQ-000001","quantity":25},"acceptedAt":"2026-11-11T00:00:00Z"}
            """);
        var state=ack.deepCopy().put("executions",0).putNull("result");
        var missing=json.readTree("""
            {"title":"Отсутствует","status":404,"code":"OPERATION_NOT_FOUND"}
            """);
        record Case(String step,int status,tools.jackson.databind.JsonNode body,boolean failed,DeliveryAttempt.Outcome expected) {}
        for (var probe:java.util.List.of(
            new Case("PUT",202,ack,false,DeliveryAttempt.Outcome.ACKNOWLEDGED),
            new Case("PUT",200,ack,false,DeliveryAttempt.Outcome.ACKNOWLEDGED),
            new Case("GET",200,state,false,DeliveryAttempt.Outcome.ACKNOWLEDGED),
            new Case("GET",202,state,false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("PUT",202,state,false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("GET",200,ack,false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("PUT",202,ack.deepCopy().put("operationId",UUID.randomUUID().toString()),false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("GET",404,missing,false,DeliveryAttempt.Outcome.NOT_FOUND),
            new Case("PUT",404,missing,false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("GET",404,null,false,DeliveryAttempt.Outcome.PROTOCOL_ERROR),
            new Case("PUT",0,null,true,DeliveryAttempt.Outcome.CONNECT_FAILED),
            new Case("PUT",0,null,false,DeliveryAttempt.Outcome.TEMPORARY_FAILURE),
            new Case("PUT",503,null,false,DeliveryAttempt.Outcome.TEMPORARY_FAILURE))) {
            var attempt=new DeliveryAttempt(identity.id(),UUID.randomUUID(),probe.step(),1,1,identity.request());
            var decoded=protocol.delivery(attempt,new ExchangeReply(probe.status(),probe.body(),probe.failed()));
            assertEquals(probe.expected(),decoded.outcome(),probe.toString());
            assertEquals(probe.status(),decoded.httpStatus());
            assertEquals(probe.failed(),decoded.connectionFailed());
            assertEquals(probe.expected()==DeliveryAttempt.Outcome.PROTOCOL_ERROR,decoded.protocolFailure()!=null);
        }
    }

    @Test
    void validFeedEnvelopeRetainsInvalidEventsForDiagnosisAndPreservesOrder() {
        var valid=(tools.jackson.databind.node.ObjectNode)json.readTree(result);
        var malformed=valid.deepCopy().put("operationId","0-0-4000-8000-1");
        var page=json.createArrayNode()
            .add(json.createObjectNode().put("cursor",11).set("result",valid))
            .add(json.createObjectNode().put("cursor",12).set("result",malformed))
            .add(json.createObjectNode().put("cursor",13));
        var decoded=protocol.feed(new ExchangeReply(200,page,false),10);
        assertEquals(ExternalExchange.FeedStatus.READY,decoded.status());
        assertEquals(java.util.List.of(11L,12L,13L),decoded.events().stream().map(ExternalExchange.IncomingEvent::cursor).toList());
        assertNotNull(decoded.events().get(0).result());
        assertNull(decoded.events().get(1).result());
        assertEquals(identity.id(),decoded.events().get(1).operationId(),"Diagnostic identity keeps the former lenient extraction");
        assertEquals(malformed,decoded.events().get(1).evidence());
        assertNull(decoded.events().get(2).operationId());
        assertNull(decoded.events().get(2).result());
        assertEquals(ExternalExchange.FeedStatus.INVALID_PAGE,protocol.feed(new ExchangeReply(200,page,false),11).status());
        assertEquals(ExternalExchange.FeedStatus.UNAVAILABLE,protocol.feed(new ExchangeReply(503,null,false),10).status());
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
