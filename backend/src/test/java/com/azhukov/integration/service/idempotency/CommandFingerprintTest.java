package com.azhukov.integration.service.idempotency;

import com.azhukov.integration.config.DocumentJsonConfiguration;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.review.IssueResolution;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.dto.review.IssueCommands;
import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.dto.task.RenameTask;
import com.azhukov.integration.service.idempotency.ContentFingerprint;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import tools.jackson.databind.json.JsonMapper;

import static org.junit.jupiter.api.Assertions.*;

class CommandFingerprintTest {
    private final JsonMapper json = mapper();
    private static JsonMapper mapper() {
        var builder=JsonMapper.builder();
        new DocumentJsonConfiguration().documents().customize(builder);
        return builder.build();
    }
    private final UUID id = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private final UUID snapshot = UUID.fromString("00000000-0000-4000-8000-000000000099");

    @TestFactory
    Stream<DynamicTest> existingCommandsKeepTheirPersistedFingerprints() throws Exception {
        var resource = getClass().getResourceAsStream("/compatibility/command-fingerprints.json");
        assertNotNull(resource);
        final tools.jackson.databind.JsonNode fixtures;
        try (resource) { fixtures = json.readTree(resource); }
        var inputs = new LinkedHashMap<String,Object>();
        inputs.put("create", new CreateTaskRequest("Проверка заявки",new Request("REQ-000001",25)));
        inputs.put("rename", new RenameCommand(id,new RenameTaskRequest("Новое имя",9007199254740990L)));
        inputs.put("take", new Target(id,new TakeIssueRequest(2L)));
        inputs.put("retry", new Target(id,new RetryRequest(2L,"Повтор")));
        inputs.put("retry-with-snapshot", new Target(id,new RetryRequest(2L,"Повтор").reconciliationId(snapshot)));
        inputs.put("resolve", new Target(id,new ResolveIssueRequest(2L,snapshot,ResolutionAction.ACKNOWLEDGE_DIFFERENCE,"Проверено")));
        inputs.put("reconcile",id);
        inputs.put("create-application",new CreateTask("Проверка заявки",new TaskInput("REQ-000001",25)));
        inputs.put("rename-application",new RenameCommand(id,new RenameTask("Новое имя",9007199254740990L)));
        inputs.put("take-application",new Target(id,new IssueCommands.Take(2L)));
        inputs.put("retry-application",new Target(id,new IssueCommands.Retry(2L,"Повтор",null)));
        inputs.put("retry-with-snapshot-application",new Target(id,new IssueCommands.Retry(2L,"Повтор",snapshot)));
        inputs.put("resolve-application",new Target(id,new IssueCommands.Resolve(2L,snapshot,IssueResolution.Action.ACKNOWLEDGE_DIFFERENCE,"Проверено")));
        return inputs.entrySet().stream().map(entry -> DynamicTest.dynamicTest(entry.getKey(),() -> {
            var expected = fixtures.get(entry.getKey().replace("-application",""));
            // Compare the persisted JSON, not Jackson's in-memory IntNode versus LongNode.
            assertEquals(expected.get("input"),json.readTree(json.writeValueAsString(entry.getValue())),"Persisted input shape changed");
            assertEquals(expected.get("sha256").asString(),ContentFingerprint.of(json,entry.getValue()));
        }));
    }

    @Test
    void keyOrderIsIrrelevantButNullAndArrayOrderRemainSignificant() {
        var one = new LinkedHashMap<String,Object>();
        one.put("b",Map.of("quantity",25,"reference","REQ-000001")); one.put("a",Arrays.asList("x",null,2));
        var two = new LinkedHashMap<String,Object>();
        two.put("a",Arrays.asList("x",null,2)); two.put("b",Map.of("reference","REQ-000001","quantity",25));
        assertEquals(ContentFingerprint.of(json,one),ContentFingerprint.of(json,two));
        two.put("a",Arrays.asList(2,null,"x"));
        assertNotEquals(ContentFingerprint.of(json,one),ContentFingerprint.of(json,two));
        var explicitNull = new LinkedHashMap<String,Object>(); explicitNull.put("optional",null);
        assertNotEquals(ContentFingerprint.of(json,Map.of()),ContentFingerprint.of(json,explicitNull));
    }

    private record RenameCommand(UUID taskId,Object input) {}
    private record Target(UUID id,Object input) {}
}
