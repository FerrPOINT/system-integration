package com.azhukov.integration.infrastructure.http;

import com.azhukov.integration.domain.exchange.OperationIdentity;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.RuleViolation;
import tools.jackson.databind.JsonNode;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

public final class ExchangeProtocol {
    public OperationIdentity acknowledgement(JsonNode body, OperationIdentity expected) {
        object(body, Set.of("operationId", "request", "acceptedAt"));
        var identity = identity(body);
        identity.requireSame(expected);
        time(body,"acceptedAt");
        return identity;
    }

    public OperationSnapshot state(JsonNode body, OperationIdentity expected) {
        var state = state(body);
        state.identity().requireSame(expected);
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
        return new OperationResult(identity.id(),identity.request(),integer(body,"version"),
            BusinessStatus.valueOf(text(body,"status")),
            body.has("completedAt") ? time(body,"completedAt") : null,
            body.has("rejectionCode") ? text(body,"rejectionCode") : null);
    }

    public static boolean missingOperation(int status,JsonNode body) {
        return status==404 && body!=null && body.isObject() && body.path("title").isString() &&
            body.path("status").isIntegralNumber() && body.path("status").canConvertToInt() && body.path("status").intValue()==404 &&
            body.path("code").isString() && body.path("code").asString().equals("OPERATION_NOT_FOUND");
    }

    private OperationIdentity identity(JsonNode body) {
        UUID id;
        try {
            String value = text(body, "operationId");
            id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) throw invalid();
        } catch (RuntimeException error) { throw invalid(); }
        var request = body.get("request");
        object(request, Set.of("reference", "quantity"));
        String reference = text(request, "reference");
        int quantity = integer(request, "quantity");
        try { return new OperationIdentity(id,new TaskInput(reference,quantity)); }
        catch (RuleViolation malformed) { throw invalid(); }
    }

    private static String text(JsonNode body, String name) {
        var value = body.get(name);
        if (value == null || !value.isString()) throw invalid();
        return value.asString();
    }

    private static int integer(JsonNode body, String name) {
        var value = body.get(name);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt()) throw invalid();
        return value.intValue();
    }

    private static OffsetDateTime time(JsonNode body, String name) {
        try {
            var value = OffsetDateTime.parse(text(body, name));
            if (!value.getOffset().equals(ZoneOffset.UTC)) throw invalid();
            return value;
        } catch (RuntimeException error) { throw invalid(); }
    }

    private static void object(JsonNode body, Set<String> fields) {
        if (body == null || !body.isObject()) throw invalid();
        for (var field : body.properties()) if (!fields.contains(field.getKey())) throw invalid();
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Ответ внешней системы не соответствует контракту");
    }
}
