package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.json.ContentFingerprint;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.json.JsonMapper;

@Tag("postgres")
class TaskNumberMigrationTest {
    private static final String DATABASE = "jdbc:postgresql://127.0.0.1:19632/si_test";
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void numberedTasksKeepTheirKeysAndPreviousComparisonsRemainAuditable() {
        String schema = "number_fixture_" + UUID.randomUUID().toString().replace("-", "");
        String password = System.getenv("SI_TEST_DB_PASSWORD");
        var cleanup = new JdbcTemplate(new DriverManagerDataSource(DATABASE, "si_test", password));
        var database = DATABASE + "?currentSchema=" + schema;
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(database, "si_test", password));
        UUID actor = UUID.randomUUID(), task = UUID.randomUUID(), operation = UUID.randomUUID();
        UUID other = UUID.randomUUID(), issue = UUID.randomUUID(), saved = UUID.randomUUID();
        UUID createKey = UUID.randomUUID(), reconcileKey = UUID.randomUUID();
        String originalTitle = "Старая » → « партия", currentTitle = "Новое имя";
        try {
            migrate(database, password, schema, "13");
            jdbc.update("INSERT INTO users VALUES (?,'migration.owner','unused','INITIATOR')", actor);
            jdbc.update(
                    """
                    INSERT INTO tasks(id,owner_id,operation_id,title,title_revision,request_reference,request_quantity,created_at)
                    VALUES (?,?,?,?,2,'REQ-000100',25,'2026-01-02T00:00:00Z'),
                           (?,?,?,'Соседнее задание',1,'REQ-000100',25,'2026-01-01T00:00:00Z')
                    """,
                    task,
                    actor,
                    operation,
                    currentTitle,
                    other,
                    actor,
                    UUID.randomUUID());
            jdbc.update(
                    """
                    INSERT INTO task_history(id,task_id,operation_id,actor,actor_user_id,event_type,summary)
                    VALUES (?,?,?,'USER',?,'RENAMED',?)
                    """,
                    UUID.randomUUID(),
                    task,
                    operation,
                    actor,
                    "Название изменено: «" + originalTitle + "» → «" + currentTitle + "»");
            var request = Map.of("quantity", 25, "reference", "REQ-000100");
            insertReceipt(
                    jdbc,
                    actor,
                    "CREATE_TASK",
                    createKey,
                    ContentFingerprint.of(json, Map.of("title", originalTitle, "request", request)),
                    json.writeValueAsString(Map.of("taskId", task)));
            String snapshot =
                    """
                    {"reconciliationId":"%s","taskId":"%s","operationId":"%s","checkedAt":"2026-01-03T00:00:00Z",
                     "checkedBy":"%s","outcome":"DIFFERENCE","externalAvailability":"PRESENT","issueId":"%s",
                     "local":{"request":{"reference":"REQ-000100","quantity":25},"deliveryStatus":"QUEUED","businessStatus":"PENDING"},
                     "external":{"operationId":"%s","request":{"reference":"REQ-000101","quantity":25},
                                 "executions":0,"acceptedAt":"2026-01-03T00:00:00Z","result":null}}
                    """
                            .formatted(saved, task, operation, actor, issue, operation);
            jdbc.update(
                    """
                    INSERT INTO reconciliations(id,task_id,exchange_version,checked_at,checked_by,snapshot)
                    VALUES (?,?,1,clock_timestamp(),?,?::jsonb)
                    """,
                    saved,
                    task,
                    actor,
                    snapshot);
            jdbc.update(
                    """
                    INSERT INTO exchange_issues(id,task_id,operation_id,scope,fingerprint,kind,summary,evidence,latest_reconciliation_id)
                    VALUES (?,?,?,?,?,'RECONCILIATION_DIFFERENCE','Исходное расхождение','{}',?)
                    """,
                    issue,
                    task,
                    operation,
                    operation.toString(),
                    issue.toString(),
                    saved);
            insertReceipt(jdbc, actor, "RECONCILE", reconcileKey, ContentFingerprint.of(json, task), snapshot);

            migrate(database, password, schema, "15");

            assertEquals(
                    List.of(1L, 2L),
                    jdbc.queryForList("SELECT task_number FROM tasks ORDER BY created_at", Long.class));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM task_history", Integer.class));
            assertEquals(2L, jdbc.queryForObject("SELECT exchange_version FROM tasks WHERE id=?", Long.class, task));
            assertEquals(
                    1L,
                    jdbc.queryForObject("SELECT exchange_version FROM reconciliations WHERE id=?", Long.class, saved));
            assertEquals(
                    ContentFingerprint.of(json, new CreateTask(originalTitle, 25)),
                    jdbc.queryForObject(
                            "SELECT fingerprint FROM command_receipts WHERE idempotency_key=?",
                            String.class,
                            createKey));
            assertEquals(
                    task.toString(),
                    jdbc.queryForObject(
                            "SELECT response_body->>'taskId' FROM command_receipts WHERE idempotency_key=?",
                            String.class,
                            createKey));
            var body =
                    json.readTree(
                            jdbc.queryForObject(
                                    "SELECT snapshot::text FROM reconciliations WHERE id=?", String.class, saved));
            assertEquals("DIFFERENCE", body.path("outcome").asString());
            assertTrue(body.path("diagnostic").asString().contains("REQ-000100"));
            assertTrue(body.path("diagnostic").asString().contains("REQ-000101"));
            assertFalse(body.path("external").path("request").has("reference"));
            assertEquals(
                    body,
                    json.readTree(
                            jdbc.queryForObject(
                                    "SELECT response_body::text FROM command_receipts WHERE idempotency_key=?",
                                    String.class,
                                    reconcileKey)));
            assertEquals(
                    3L,
                    jdbc.queryForObject(
                            """
                            INSERT INTO tasks(id,owner_id,operation_id,title,request_quantity)
                            VALUES (?,?,?,'После обновления',25) RETURNING task_number
                            """,
                            Long.class,
                            UUID.randomUUID(),
                            actor,
                            UUID.randomUUID()));
            assertThrows(
                    DataAccessException.class,
                    () -> jdbc.update("UPDATE reconciliations SET snapshot='{}' WHERE id=?", saved));
            assertThrows(
                    DataAccessException.class, () -> jdbc.update("DELETE FROM task_history WHERE task_id=?", task));
        } finally {
            cleanup.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private void insertReceipt(
            JdbcTemplate jdbc, UUID actor, String command, UUID key, String fingerprint, String body) {
        jdbc.update(
                """
                INSERT INTO command_receipts(actor_id,command_type,idempotency_key,fingerprint,response_body)
                VALUES (?,?,?,?,?::jsonb)
                """,
                actor,
                command,
                key,
                fingerprint,
                body);
    }

    private static void migrate(String database, String password, String schema, String target) {
        Flyway.configure()
                .dataSource(database, "si_test", password)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
