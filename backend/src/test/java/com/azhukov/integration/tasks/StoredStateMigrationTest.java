package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.support.PostgresTest;
import java.util.ArrayList;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class StoredStateMigrationTest extends PostgresTest {
    private record Fixture(UUID task, UUID operation, UUID issue, String delivery, String kind, String status) {}

    @Test
    void upgradeNormalizesOldDelayedWorkAndPreservesAuditCountsAndReceiptReplayData() throws Exception {
        String schema = "si_cleanup_" + UUID.randomUUID().toString().replace("-", "");
        assertTrue(schema.matches("si_cleanup_[0-9a-f]+"));
        String base;
        try (var connection = jdbc.getDataSource().getConnection()) {
            base = connection.getMetaData().getURL();
            assertTrue(base.startsWith("jdbc:postgresql://127.0.0.1:19632/si_test"));
        }
        String url = base + "?currentSchema=" + schema;
        String password = System.getenv("SI_TEST_DB_PASSWORD");
        var isolated = new JdbcTemplate(new DriverManagerDataSource(url, "si_test", password));
        var rows = new ArrayList<Fixture>();
        UUID actor = UUID.randomUUID(), receiptKey = UUID.randomUUID(), activeClaim = UUID.randomUUID();
        try {
            migrate(url, password, schema, "10");
            isolated.update(
                    "INSERT INTO users(id,username,password_hash,role) VALUES (?,'migration-fixture','unused','INITIATOR')",
                    actor);
            String[][] cases = {
                {"QUEUED", "DELIVERY_DELAYED", "OPEN"},
                {"RETRY_WAIT", "DELIVERY_DELAYED", "OPEN"},
                {"UNKNOWN", "DELIVERY_DELAYED", "OPEN"},
                {"NEEDS_REVIEW", "DELIVERY_DELAYED", "OPEN"},
                {"RETRY_WAIT", "DELIVERY_DELAYED", "RESOLVED"},
                {"UNKNOWN", "DELIVERY_UNCERTAIN", "OPEN"},
                {"NEEDS_REVIEW", "PROTOCOL_ERROR", "OPEN"}
            };
            for (String[] entry : cases) {
                var row =
                        new Fixture(
                                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), entry[0], entry[1], entry[2]);
                rows.add(row);
                isolated.update(
                        "INSERT INTO tasks(id,operation_id,owner_id,title,request_reference,request_quantity,delivery_status,exchange_version) VALUES (?,?,?,'Migration fixture','REQ-000001',25,?,10)",
                        row.task(),
                        row.operation(),
                        actor,
                        row.delivery());
                isolated.update(
                        "INSERT INTO delivery_queue(operation_id,attempts,automatic_attempts,due_at) VALUES (?,7,5,CASE WHEN ?='NEEDS_REVIEW' THEN 'infinity'::timestamptz ELSE clock_timestamp() END)",
                        row.operation(),
                        row.delivery());
                isolated.update(
                        "INSERT INTO exchange_issues(id,task_id,operation_id,scope,fingerprint,kind,status,summary,evidence) VALUES (?,?,?,?,?,?,?,'Original diagnostic','{}')",
                        row.issue(),
                        row.task(),
                        row.operation(),
                        row.operation().toString(),
                        row.issue().toString(),
                        row.kind(),
                        row.status());
                isolated.update(
                        "INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary) VALUES (?,?,?,'SYSTEM','CREATED','Original history')",
                        UUID.randomUUID(),
                        row.task(),
                        row.operation());
            }
            var claimed = rows.get(2);
            isolated.update(
                    "INSERT INTO delivery_attempts(id,operation_id,number,step) VALUES (?,?,7,'GET')",
                    activeClaim,
                    claimed.operation());
            isolated.update(
                    "UPDATE delivery_queue SET claim_id=?,claimed_until=clock_timestamp()+interval '15 seconds' WHERE operation_id=?",
                    activeClaim,
                    claimed.operation());
            isolated.update(
                    "INSERT INTO command_receipts(actor_id,command_type,idempotency_key,fingerprint,http_status,response_body) VALUES (?,'CREATE_TASK',?,'unchanged-fingerprint',201,jsonb_build_object('taskId',?::text))",
                    actor,
                    receiptKey,
                    rows.getFirst().task());
            var receipt =
                    isolated.queryForMap("SELECT fingerprint,response_body::text,created_at FROM command_receipts");
            var historyIds = isolated.queryForList("SELECT id FROM task_history ORDER BY id", UUID.class);

            migrate(url, password, schema, "11");
            for (int i = 0; i < rows.size(); i++) {
                var row = rows.get(i);
                var task =
                        isolated.queryForMap(
                                "SELECT delivery_status,exchange_version FROM tasks WHERE id=?", row.task());
                var queue =
                        isolated.queryForMap(
                                "SELECT attempts,automatic_attempts,claim_id,claimed_until,due_at='infinity'::timestamptz AS parked FROM delivery_queue WHERE operation_id=?",
                                row.operation());
                boolean changed = i < 3;
                assertEquals(changed ? "NEEDS_REVIEW" : row.delivery(), task.get("delivery_status"));
                assertEquals(changed ? 11L : 10L, task.get("exchange_version"));
                assertEquals(7, queue.get("attempts"));
                assertEquals(5, queue.get("automatic_attempts"));
                assertNull(queue.get("claim_id"));
                assertNull(queue.get("claimed_until"));
                assertEquals(changed || row.delivery().equals("NEEDS_REVIEW"), queue.get("parked"));
                var issue =
                        isolated.queryForMap(
                                "SELECT kind,status,summary,issue_revision FROM exchange_issues WHERE id=?",
                                row.issue());
                assertEquals(row.kind(), issue.get("kind"));
                assertEquals(row.status(), issue.get("status"));
                assertEquals("Original diagnostic", issue.get("summary"));
                assertEquals(1L, issue.get("issue_revision"));
            }
            assertEquals(
                    "INTERRUPTED",
                    isolated.queryForObject(
                            "SELECT outcome FROM delivery_attempts WHERE id=?", String.class, activeClaim));
            assertNotNull(
                    isolated.queryForObject(
                            "SELECT finished_at FROM delivery_attempts WHERE id=?",
                            java.time.OffsetDateTime.class,
                            activeClaim));
            assertEquals(
                    3,
                    isolated.queryForObject(
                            "SELECT count(*) FROM task_history WHERE details->>'migration'='V11'", Integer.class));
            assertEquals(
                    rows.size(),
                    isolated.queryForObject(
                            "SELECT count(*) FROM task_history WHERE summary='Original history'", Integer.class));
            assertEquals(
                    historyIds,
                    isolated.queryForList(
                            "SELECT id FROM task_history WHERE summary='Original history' ORDER BY id", UUID.class));

            migrate(url, password, schema, "12");
            assertEquals(
                    receipt,
                    isolated.queryForMap("SELECT fingerprint,response_body::text,created_at FROM command_receipts"));
            assertEquals(
                    0,
                    isolated.queryForObject(
                            "SELECT count(*) FROM information_schema.columns WHERE table_schema=? AND table_name='command_receipts' AND column_name='http_status'",
                            Integer.class,
                            schema));
            assertEquals(
                    rows.getFirst().task().toString(),
                    json.readTree(
                                    isolated.queryForObject(
                                            "SELECT response_body::text FROM command_receipts WHERE actor_id=? AND command_type='CREATE_TASK' AND idempotency_key=?",
                                            String.class,
                                            actor,
                                            receiptKey))
                            .get("taskId")
                            .asString());
            migrate(url, password, schema, "12");
            assertEquals(
                    3,
                    isolated.queryForObject(
                            "SELECT count(*) FROM task_history WHERE details->>'migration'='V11'", Integer.class));
            assertEquals(rows.size(), isolated.queryForObject("SELECT count(*) FROM tasks", Integer.class));
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private static void migrate(String url, String password, String schema, String target) {
        Flyway.configure()
                .dataSource(url, "si_test", password)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
