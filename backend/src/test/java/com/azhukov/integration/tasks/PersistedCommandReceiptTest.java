package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.azhukov.integration.support.PostgresTest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class PersistedCommandReceiptTest extends PostgresTest {
    @org.springframework.beans.factory.annotation.Autowired
    com.azhukov.integration.service.idempotency.IdempotencyService commands;

    @Test
    void idempotentCommandCannotRunOutsideItsCallersTransaction() {
        assertTrue(org.springframework.aop.support.AopUtils.isAopProxy(commands));
        assertThrows(
                org.springframework.transaction.IllegalTransactionStateException.class,
                () ->
                        commands.execute(
                                first,
                                com.azhukov.integration.dto.CommandType.CREATE_TASK,
                                UUID.randomUUID(),
                                java.util.Map.of(),
                                String.class,
                                () -> fail("Callback must not run")));
        assertEquals(0, count("command_receipts"));
    }

    @Test
    void historicalCreateResponseAndFingerprintReplayWithoutAnotherWrite() throws Exception {
        var owner = login("initiator.one");
        var key = UUID.randomUUID();
        var task = created(owner, key);
        var resource = getClass().getResourceAsStream("/compatibility/command-fingerprints.json");
        assertNotNull(resource);
        final String oldFingerprint;
        try (resource) {
            oldFingerprint = json.readTree(resource).get("create").get("sha256").asString();
        }
        assertEquals(
                oldFingerprint,
                jdbc.queryForObject(
                        "SELECT fingerprint FROM command_receipts WHERE actor_id=? AND command_type='CREATE_TASK' AND idempotency_key=?",
                        String.class,
                        first,
                        key));
        // Explicit historical wire JSON, independently of the new record serializer.
        jdbc.update(
                "UPDATE command_receipts SET response_body=jsonb_build_object('taskId',?::text) WHERE actor_id=? AND command_type='CREATE_TASK' AND idempotency_key=?",
                task,
                first,
                key);
        var replay = create(owner, key, CREATE);
        status(201, replay);
        assertEquals(task.toString(), body(replay).get("taskId").asString());
        assertEquals(1, count("tasks"));
        assertEquals(1, count("task_history"));
        assertEquals(1, count("delivery_queue"));
        assertEquals(1, count("command_receipts"));
        status(409, create(owner, key, CREATE.replace("25", "26")));
        assertEquals(
                201,
                jdbc.queryForObject(
                        "SELECT http_status FROM command_receipts WHERE actor_id=? AND command_type='CREATE_TASK' AND idempotency_key=?",
                        Integer.class,
                        first,
                        key));
    }

    @Test
    void historicalRenameResponseDoesNotOverwriteANewerTitleOrExpandAccess() throws Exception {
        var owner = login("initiator.one");
        var task = created(owner, UUID.randomUUID());
        var key = UUID.randomUUID();
        status(200, rename(owner, task, key, "Первое имя", 1));
        var canonical =
                "{\"input\":{\"expectedTitleRevision\":1,\"title\":\"Первое имя\"},\"taskId\":\"" + task + "\"}";
        var oldFingerprint =
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        assertEquals(
                oldFingerprint,
                jdbc.queryForObject(
                        "SELECT fingerprint FROM command_receipts WHERE actor_id=? AND command_type='RENAME_TASK' AND idempotency_key=?",
                        String.class,
                        first,
                        key));
        jdbc.update(
                "UPDATE command_receipts SET response_body=?::jsonb WHERE actor_id=? AND command_type='RENAME_TASK' AND idempotency_key=?",
                "{\"title\":\"Первое имя\",\"titleRevision\":2}",
                first,
                key);
        status(200, rename(owner, task, UUID.randomUUID(), "Текущее имя", 2));
        var replay = rename(owner, task, key, "Первое имя", 1);
        status(200, replay);
        assertEquals("Первое имя", body(replay).get("title").asString());
        assertEquals(2, body(replay).get("titleRevision").asLong());
        var current = mvc.perform(get("/api/tasks/" + task).session(owner.session())).andReturn();
        status(200, current);
        assertEquals("Текущее имя", body(current).get("title").asString());
        assertEquals(3, body(current).get("titleRevision").asLong());
        status(404, rename(login("initiator.two"), task, key, "Первое имя", 1));
        assertEquals(3, count("task_history"));
        assertEquals(3, count("command_receipts"));
    }
}
