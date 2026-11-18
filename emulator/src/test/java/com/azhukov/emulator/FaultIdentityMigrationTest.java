package com.azhukov.emulator;

import static org.junit.jupiter.api.Assertions.*;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Tag("postgres")
class FaultIdentityMigrationTest {
    private static final String DATABASE = "jdbc:postgresql://127.0.0.1:19632/si_emulator_test";

    @Test
    void boundAndPendingFaultsKeepTheirOperationAndCursor() {
        String schema = "fault_fixture_" + UUID.randomUUID().toString().replace("-", "");
        String password = System.getenv("SI_EMULATOR_TEST_DB_PASSWORD");
        var database = DATABASE + "?currentSchema=" + schema;
        var cleanup = new JdbcTemplate(new DriverManagerDataSource(DATABASE, "si_emulator_test", password));
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(database, "si_emulator_test", password));
        UUID accepted = UUID.randomUUID(), pending = UUID.randomUUID();
        try {
            migrate(database, password, schema, "2");
            String payload =
                    """
                    {"operationId":"%s","request":{"reference":"REQ-000100","quantity":25},
                     "version":2,"status":"SUCCEEDED","completedAt":"2026-01-02T00:00:01Z"}
                    """
                            .formatted(accepted);
            jdbc.update(
                    """
                    INSERT INTO operations(id,reference,quantity,executions,result,completed_at)
                    VALUES (?,'REQ-000100',25,1,?::jsonb,'2026-01-02T00:00:01Z')
                    """,
                    accepted,
                    payload);
            jdbc.update(
                    """
                    INSERT INTO result_events(operation_id,version,copy_number,cursor,payload,publish_after)
                    VALUES (?,2,0,1,?::jsonb,clock_timestamp())
                    """,
                    accepted,
                    payload);
            jdbc.update("UPDATE feed_position SET last_cursor=1");
            jdbc.update(
                    """
                    INSERT INTO faults(reference,mode,bound_operation_id)
                    VALUES ('REQ-000100','DELAY_RESULT',?), ('REQ-000101','UNAVAILABLE',NULL)
                    """,
                    accepted);
            assertThrows(FlywayException.class, () -> migrate(database, password, schema, "3"));
            jdbc.execute(
                    "CREATE TABLE task_number_fault_mapping(reference text PRIMARY KEY,operation_id uuid NOT NULL UNIQUE)");
            jdbc.update("INSERT INTO task_number_fault_mapping VALUES ('REQ-000101',?)", pending);
            migrate(database, password, schema, "3");
            assertEquals(
                    "DELAY_RESULT",
                    jdbc.queryForObject("SELECT mode FROM faults WHERE operation_id=?", String.class, accepted));
            assertEquals(
                    "UNAVAILABLE",
                    jdbc.queryForObject("SELECT mode FROM faults WHERE operation_id=?", String.class, pending));
            assertEquals(1L, jdbc.queryForObject("SELECT last_cursor FROM feed_position", Long.class));
            assertEquals(1L, jdbc.queryForObject("SELECT cursor FROM result_events", Long.class));
            assertEquals(1, jdbc.queryForObject("SELECT executions FROM operations", Integer.class));
            assertEquals(
                    25,
                    jdbc.queryForObject(
                            "SELECT (result #>> '{request,quantity}')::int FROM operations", Integer.class));
            assertNull(
                    jdbc.queryForObject("SELECT payload #>> '{request,reference}' FROM result_events", String.class));
        } finally {
            cleanup.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private static void migrate(String database, String password, String schema, String target) {
        Flyway.configure()
                .dataSource(database, "si_emulator_test", password)
                .schemas(schema)
                .defaultSchema(schema)
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }
}
