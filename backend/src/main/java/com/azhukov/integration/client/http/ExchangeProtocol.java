package com.azhukov.integration.client.http;

import com.azhukov.integration.client.ExternalExchangeClient.*;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.UtcTimestamp;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.exchange.OperationIdentity;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.TaskInput;
import java.time.OffsetDateTime;
import java.util.regex.Pattern;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

public final class ExchangeProtocol {
    private static final Pattern UTC_TIME=Pattern.compile(
        "[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?(?:[Zz]|\\+00:00)");

    public OperationIdentity acknowledgement(JsonNode body, OperationIdentity expected) {
        object(body, Set.of("operationId", "request", "acceptedAt"));
        var identity = identity(body);
        try { identity.requireSame(expected); }
        catch (IllegalArgumentException mismatch) { throw invalid("IDENTITY_MISMATCH","operationId/request"); }
        time(body,"acceptedAt");
        return identity;
    }

    public OperationSnapshot state(JsonNode body, OperationIdentity expected) {
        var state = state(body);
        try { state.identity().requireSame(expected); }
        catch (IllegalArgumentException mismatch) { throw invalid("IDENTITY_MISMATCH","operationId/request"); }
        return state;
    }

    public OperationSnapshot state(JsonNode body) {
        object(body, Set.of("operationId", "request", "acceptedAt", "executions", "result"));
        var identity = identity(body);
        int executions = integer(body,"executions");
        if (!body.has("result")) throw invalid();
        var result = body.get("result").isNull() ? null : result(body.get("result"));
        return new OperationSnapshot(identity.id(),identity.request(),time(body,"acceptedAt"),executions,result);
    }

    public OperationResult result(JsonNode body) {
        object(body, Set.of("operationId", "request", "version", "status", "completedAt", "rejectionCode"));
        var identity = identity(body);
        int version=integer(body,"version");
        if (version!=1 && version!=2) throw invalid("UNSUPPORTED_VERSION","version");
        var status=switch (text(body,"status")) {
            case "RUNNING" -> BusinessStatus.RUNNING;
            case "SUCCEEDED" -> BusinessStatus.SUCCEEDED;
            case "REJECTED" -> BusinessStatus.REJECTED;
            default -> throw invalid("INVALID_STATUS","status");
        };
        return new OperationResult(identity.id(),identity.request(),version,status,
            body.has("completedAt") ? time(body,"completedAt") : null,
            body.has("rejectionCode") ? text(body,"rejectionCode") : null);
    }

    public static boolean missingOperation(int status,JsonNode body) {
        return status==404 && body!=null && body.isObject() && body.path("title").isString() &&
            body.path("status").isIntegralNumber() && body.path("status").canConvertToInt() && body.path("status").intValue()==404 &&
            body.path("code").isString() && body.path("code").asString().equals("OPERATION_NOT_FOUND");
    }

    public DeliveryReply delivery(DeliveryAttempt attempt,ExchangeReply reply) {
        String failure=reply.protocolFailure();
        Object evidence=reply.body();
        if (failure!=null) evidence=new ProtocolEvidence(evidence,"RESPONSE_SIZE at body");
        if (failure==null && ((attempt.step().equals("PUT") && (reply.status()==200 || reply.status()==202)) ||
            (attempt.step().equals("GET") && reply.status()==200))) {
            try {
                var expected=new OperationIdentity(attempt.operationId(),attempt.request());
                if (attempt.step().equals("PUT")) acknowledgement(reply.body(),expected);
                else state(reply.body(),expected);
                return new DeliveryReply(DeliveryAttempt.Outcome.ACKNOWLEDGED,reply.status(),reply.connectionFailed(),null,reply.body());
            } catch (IllegalArgumentException malformed) {
                failure="Подтверждение не соответствует контракту или исходному запросу";
                evidence=diagnostics(reply.body(),malformed);
            }
        }
        boolean missing=attempt.step().equals("GET") && missingOperation(reply.status(),reply.body());
        boolean temporary=reply.status()==0 || reply.status()>=500;
        if (failure==null && !temporary && !missing) failure="Постоянная ошибка внешнего протокола, HTTP "+reply.status();
        var outcome=failure!=null ? DeliveryAttempt.Outcome.PROTOCOL_ERROR : missing ? DeliveryAttempt.Outcome.NOT_FOUND :
            reply.connectionFailed() ? DeliveryAttempt.Outcome.CONNECT_FAILED : DeliveryAttempt.Outcome.TEMPORARY_FAILURE;
        return new DeliveryReply(outcome,reply.status(),reply.connectionFailed(),failure,evidence);
    }

    public FeedReply feed(ExchangeReply reply,long after) {
        if (reply.protocolFailure()!=null) return new FeedReply(FeedStatus.INVALID_PAGE,List.of(),new ProtocolEvidence(reply.protocolFailure(),"RESPONSE_SIZE at body"));
        if (reply.status()==0 || reply.status()>=500) return new FeedReply(FeedStatus.UNAVAILABLE,List.of(),reply.body());
        if (reply.status()!=200 || !validPage(reply.body(),after))
            return new FeedReply(FeedStatus.INVALID_PAGE,List.of(),new ProtocolEvidence(reply.body(),"INVALID_PAGE at cursor/structure"));
        var events=new ArrayList<IncomingEvent>();
        for (var event:reply.body()) {
            var raw=event.get("result");
            OperationResult result=null;
            UUID operationId=null;
            Object evidence=raw;
            try { result=result(raw); operationId=result.operationId(); }
            catch (IllegalArgumentException malformed) {
                evidence=diagnostics(raw,malformed);
                try { operationId=UUID.fromString(raw.path("operationId").asString()); }
                catch (RuntimeException unknown) { /* Missing/invalid identity is a feed-level issue. */ }
            }
            events.add(new IncomingEvent(event.get("cursor").longValue(),operationId,result,evidence));
        }
        return new FeedReply(FeedStatus.READY,events,reply.body());
    }

    public static boolean validPage(JsonNode page,long after) {
        if (page==null || !page.isArray() || page.size()>100) return false;
        long previous=after;
        for (var event:page) {
            if (!event.isObject()) return false;
            for (var field:event.properties()) if (!field.getKey().equals("cursor") && !field.getKey().equals("result")) return false;
            var cursor=event.get("cursor");
            if (cursor==null || !cursor.isIntegralNumber() || !cursor.canConvertToLong()) return false;
            long value=cursor.longValue();
            if (value<=previous || value>9007199254740991L) return false;
            previous=value;
        }
        return true;
    }

    private OperationIdentity identity(JsonNode body) {
        UUID id;
        try {
            String value = text(body, "operationId");
            id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) throw invalid();
        } catch (RuntimeException error) { throw invalid("INVALID_UUID","operationId"); }
        var request = body.get("request");
        object(request, Set.of("reference", "quantity"));
        String reference = text(request, "reference");
        int quantity = integer(request, "quantity");
        try { return new OperationIdentity(id,new TaskInput(reference,quantity)); }
        catch (RuleViolation malformed) { throw invalid(); }
    }

    private static String text(JsonNode body, String name) {
        var value = body.get(name);
        if (value == null || !value.isString()) throw invalid("FIELD_TYPE",name);
        return value.asString();
    }

    private static int integer(JsonNode body, String name) {
        var value = body.get(name);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt()) throw invalid("FIELD_TYPE",name);
        return value.intValue();
    }

    private static OffsetDateTime time(JsonNode body, String name) {
        try {
            String timestamp=text(body,name);
            if (!UTC_TIME.matcher(timestamp).matches()) throw invalid();
            var value = OffsetDateTime.parse(timestamp);
            if (!UtcTimestamp.isSupported(value)) throw invalid();
            return value;
        } catch (RuntimeException error) { throw invalid("INVALID_UTC",name); }
    }

    private static void object(JsonNode body, Set<String> fields) {
        if (body == null || !body.isObject()) throw invalid("EXPECTED_OBJECT","document");
        for (var field : body.properties()) if (!fields.contains(field.getKey())) throw invalid("UNKNOWN_FIELD","document");
    }

    static ProtocolEvidence diagnostics(Object content,IllegalArgumentException failure) {
        return new ProtocolEvidence(content,failure instanceof Violation ? failure.getMessage() : "INVALID_VARIANT at result");
    }

    private static IllegalArgumentException invalid() { return invalid("INVALID_VARIANT","result"); }
    private static IllegalArgumentException invalid(String code,String path) { return new Violation(code+" at "+path); }
    private static final class Violation extends IllegalArgumentException {
        Violation(String detail) { super(detail); }
    }
}
