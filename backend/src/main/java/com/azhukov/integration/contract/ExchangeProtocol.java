package com.azhukov.integration.contract;

import com.azhukov.integration.contract.external.model.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Set;
import java.util.UUID;

public final class ExchangeProtocol {
    private final ObjectMapper json;

    public ExchangeProtocol(ObjectMapper json) { this.json = json; }

    public record Identity(UUID id, OperationInput request) {}

    public Acknowledgement acknowledgement(JsonNode body, Identity expected) {
        object(body, Set.of("operationId", "request", "acceptedAt"));
        var identity = identity(body);
        same(identity, expected);
        return new Acknowledgement(identity.id(), identity.request(), time(body, "acceptedAt"));
    }

    public OperationState state(JsonNode body, Identity expected) {
        var state = state(body);
        same(new Identity(state.getOperationId(),state.getRequest()),expected);
        return state;
    }

    public OperationState state(JsonNode body) {
        object(body, Set.of("operationId", "request", "acceptedAt", "executions", "result"));
        var identity = identity(body);
        int executions = integer(body, "executions");
        if (executions < 0 || executions > 1 || !body.has("result")) throw invalid();
        Result result = body.get("result").isNull() ? null : result(body.get("result"));
        if (result != null) same(new Identity(result.getOperationId(), result.getRequest()), identity);
        boolean terminal = result != null && result.getVersion() == Result.VersionEnum.NUMBER_2;
        if ((executions == 1) != terminal) throw invalid();
        return new OperationState(identity.id(), identity.request(), time(body, "acceptedAt"),
            OperationState.ExecutionsEnum.fromValue(executions), result);
    }

    public Result result(JsonNode body) {
        object(body, Set.of("operationId", "request", "version", "status", "completedAt", "rejectionCode"));
        var identity = identity(body);
        int version = integer(body, "version");
        String status = text(body, "status");
        if (version == 1 && status.equals("RUNNING")) {
            if (body.has("completedAt") || body.has("rejectionCode")) throw invalid();
        } else if (version == 2 && (status.equals("SUCCEEDED") || status.equals("REJECTED"))) {
            time(body, "completedAt");
            if (status.equals("REJECTED")) {
                if (!text(body, "rejectionCode").equals("QUANTITY_LIMIT_EXCEEDED")) throw invalid();
            } else if (body.has("rejectionCode")) throw invalid();
        } else throw invalid();
        // Parse only after checking conditional rules that generated Bean Validation cannot express.
        return json.treeToValue(body, Result.class);
    }

    public static void same(Identity actual, Identity expected) {
        if (!actual.equals(expected)) throw new IllegalArgumentException("ID или неизменный запрос не совпадает с заданием");
    }

    public static boolean missingOperation(int status,JsonNode body) {
        return status==404 && body!=null && body.isObject() && body.path("title").isString() &&
            body.path("status").isIntegralNumber() && body.path("status").canConvertToInt() && body.path("status").intValue()==404 &&
            body.path("code").isString() && body.path("code").asString().equals("OPERATION_NOT_FOUND");
    }

    private Identity identity(JsonNode body) {
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
        if (!reference.matches("REQ-[0-9]{6}") || quantity < 1 || quantity > 1000) throw invalid();
        return new Identity(id, new OperationInput(reference, quantity));
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
