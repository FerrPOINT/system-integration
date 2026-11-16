package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.support.PostgresTest;
import java.sql.DriverManager;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

class ParkedDeliveryMigrationTest extends PostgresTest {
    @Test
    void v10ParksOnlyPausedRowsAndPreservesAttemptsClaimsAndOtherDeliveryDates() throws Exception {
        String schema = "parked_migration_" + UUID.randomUUID().toString().replace("-", "");
        assertTrue(schema.matches("parked_migration_[0-9a-f]+"));
        String url = "jdbc:postgresql://127.0.0.1:19632/si_test?currentSchema=" + schema;
        String password = System.getenv("SI_TEST_DB_PASSWORD");
        UUID owner = UUID.randomUUID(), paused = UUID.randomUUID(), active = UUID.randomUUID();
        try {
            Flyway.configure()
                    .dataSource(url, "si_test", password)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .locations("classpath:db/migration")
                    .target("9")
                    .load()
                    .migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var sql = connection.createStatement()) {
                sql.executeUpdate("INSERT INTO users VALUES ('" + owner + "','migration.owner','fixture','INITIATOR')");
                for (UUID operation : new UUID[] {paused, active}) {
                    sql.executeUpdate(
                            "INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,delivery_status) VALUES ('"
                                    + UUID.randomUUID()
                                    + "','"
                                    + owner
                                    + "','"
                                    + operation
                                    + "','Migration fixture','REQ-000001',25,'"
                                    + (operation.equals(paused) ? "NEEDS_REVIEW" : "UNKNOWN")
                                    + "')");
                    sql.executeUpdate(
                            "INSERT INTO delivery_queue(operation_id,due_at,attempts,automatic_attempts,next_step) VALUES ('"
                                    + operation
                                    + "','2026-01-01T00:00:00Z',8,5,'GET')");
                }
                sql.executeUpdate(
                        "UPDATE delivery_queue SET claim_id='"
                                + UUID.randomUUID()
                                + "',claimed_until='2026-01-02T00:00:00Z' WHERE operation_id='"
                                + active
                                + "'");
            }
            Flyway.configure()
                    .dataSource(url, "si_test", password)
                    .schemas(schema)
                    .defaultSchema(schema)
                    .locations("classpath:db/migration")
                    .target("10")
                    .load()
                    .migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var sql = connection.createStatement();
                    var rows =
                            sql.executeQuery(
                                    "SELECT operation_id,due_at::text,attempts,automatic_attempts,next_step,claim_id IS NOT NULL FROM delivery_queue")) {
                int count = 0;
                while (rows.next()) {
                    boolean parked = rows.getObject(1, UUID.class).equals(paused);
                    assertEquals(parked ? "infinity" : "2026-01-01 00:00:00+00", rows.getString(2));
                    assertEquals(8, rows.getInt(3));
                    assertEquals(5, rows.getInt(4));
                    assertEquals("GET", rows.getString(5));
                    assertEquals(!parked, rows.getBoolean(6));
                    count++;
                }
                assertEquals(2, count);
            }
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
