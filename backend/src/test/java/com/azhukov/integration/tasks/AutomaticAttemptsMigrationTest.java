package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.support.PostgresTest;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

class AutomaticAttemptsMigrationTest extends PostgresTest {
    @Test
    void v7PreservesExistingCountsClaimsAndAuditWhileRejectingInvalidSeriesCounts() throws Exception {
        String schema = "si10_migration_" + UUID.randomUUID().toString().replace("-", "");
        assertTrue(schema.matches("si10_migration_[0-9a-f]+"));
        String baseUrl;
        try (var connection = jdbc.getDataSource().getConnection()) {
            baseUrl = connection.getMetaData().getURL();
            assertTrue(baseUrl.startsWith("jdbc:postgresql://127.0.0.1:19632/si_test"));
        }
        String url = baseUrl + "?currentSchema=" + schema;
        String password = System.getenv("SI_TEST_DB_PASSWORD");
        UUID owner = UUID.randomUUID(), claim = UUID.randomUUID();
        try {
            Flyway.configure()
                    .dataSource(url, "si_test", password)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .locations("classpath:db/migration")
                    .target("6")
                    .load()
                    .migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var sql = connection.createStatement()) {
                sql.executeUpdate("INSERT INTO users VALUES ('" + owner + "','migration.owner','fixture','INITIATOR')");
                for (int n : new int[] {0, 4, 8}) {
                    UUID task = UUID.randomUUID(), operation = UUID.randomUUID();
                    sql.executeUpdate(
                            "INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity) VALUES ('"
                                    + task
                                    + "','"
                                    + owner
                                    + "','"
                                    + operation
                                    + "','Migration fixture','REQ-000001',25)");
                    sql.executeUpdate(
                            "INSERT INTO delivery_queue(operation_id,attempts) VALUES ('" + operation + "'," + n + ")");
                }
                sql.executeUpdate(
                        "UPDATE delivery_queue SET claim_id='"
                                + claim
                                + "',claimed_until=clock_timestamp()-interval '1 second' WHERE attempts=8");
                sql.executeUpdate(
                        "INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary) SELECT gen_random_uuid(),id,operation_id,'SYSTEM','CREATED','Migration fixture' FROM tasks");
                sql.executeUpdate(
                        "INSERT INTO command_receipts VALUES ('"
                                + owner
                                + "','CREATE_TASK','"
                                + UUID.randomUUID()
                                + "','old-fingerprint',201,'{\"fixture\":true}',clock_timestamp())");
            }
            Flyway.configure()
                    .dataSource(url, "si_test", password)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var sql = connection.createStatement()) {
                try (var rows =
                        sql.executeQuery(
                                "SELECT attempts,automatic_attempts,claim_id FROM delivery_queue ORDER BY attempts")) {
                    for (int n : new int[] {0, 4, 8}) {
                        assertTrue(rows.next());
                        assertEquals(n, rows.getInt(1));
                        assertEquals(n, rows.getInt(2));
                        assertEquals(n == 8 ? claim : null, rows.getObject(3, UUID.class));
                    }
                    assertFalse(rows.next());
                }
                try (var rows =
                        sql.executeQuery(
                                "SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM task_history),(SELECT count(*) FROM command_receipts),(SELECT count(*) FROM flyway_schema_history WHERE success AND version IS NOT NULL)")) {
                    assertTrue(rows.next());
                    assertEquals(3, rows.getInt(1));
                    assertEquals(3, rows.getInt(2));
                    assertEquals(1, rows.getInt(3));
                    assertEquals(7, rows.getInt(4));
                }
                assertThrows(
                        SQLException.class, () -> sql.executeUpdate("UPDATE delivery_queue SET automatic_attempts=-1"));
                assertThrows(
                        SQLException.class,
                        () -> sql.executeUpdate("UPDATE delivery_queue SET automatic_attempts=attempts+1"));
                sql.executeUpdate("UPDATE delivery_queue SET automatic_attempts=0 WHERE attempts=8");
                try (var rows =
                        sql.executeQuery("SELECT attempts,automatic_attempts FROM delivery_queue WHERE attempts=8")) {
                    assertTrue(rows.next());
                    assertEquals(8, rows.getInt(1));
                    assertEquals(0, rows.getInt(2));
                }
            }
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
