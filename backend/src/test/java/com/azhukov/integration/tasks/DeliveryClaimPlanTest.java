package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.repository.ExchangeRepository;
import com.azhukov.integration.support.PostgresTest;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

class DeliveryClaimPlanTest extends PostgresTest {
    @Autowired ExchangeRepository exchanges;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean JdbcTemplate observedSql;

    @Test
    void aGrowingQueueDoesNotRequireReadingAlreadyDeliveredTasks() {
        jdbc.update(
                """
                INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,delivery_status)
                SELECT gen_random_uuid(),?,gen_random_uuid(),'Accepted population','REQ-000001',25,'ACKNOWLEDGED'
                FROM generate_series(1,10000)
                """,
                first);
        jdbc.execute("ANALYZE tasks");
        ready(500);
        new TransactionTemplate(transactions)
                .executeWithoutResult(tx -> {
                    clearInvocations(observedSql);
                    assertNotNull(exchanges.lockDueExchange());
                    String sql = claimSql();
                    var plan =
                            json.readTree(
                                    jdbc.queryForObject(
                                            "EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) " + sql, String.class));
                    assertEquals(1, plan.get(0).get("Plan").get("Actual Rows").asInt());
                    assertTrue(
                            rowsVisited(plan, "tasks") <= 2,
                            "Claim must look up the next task, not scan the completed population: " + plan);
                    tx.setRollbackOnly();
                });
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {0, 10000})
    void anEmptyQueueCanGrowWithoutReusingAFullScanPlan(int delivered) {
        new TransactionTemplate(transactions)
                .executeWithoutResult(tx -> {
                    // TRUNCATE keeps earlier column statistics. Give this plan-cache regression
                    // fresh relations with the production columns/indexes, all rolled back below.
                    String schema = "claim_plan_" + UUID.randomUUID().toString().replace("-", "");
                    jdbc.execute("CREATE SCHEMA " + schema);
                    jdbc.execute("CREATE TABLE " + schema + ".tasks (LIKE tasks INCLUDING ALL)");
                    jdbc.execute("CREATE TABLE " + schema + ".delivery_queue (LIKE delivery_queue INCLUDING ALL)");
                    jdbc.execute("SET LOCAL search_path TO " + schema);
                    jdbc.execute("ALTER TABLE tasks SET (autovacuum_enabled=false)");
                    jdbc.execute("ALTER TABLE delivery_queue SET (autovacuum_enabled=false)");
                    jdbc.update(
                            """
                            INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,delivery_status)
                            SELECT gen_random_uuid(),?,gen_random_uuid(),'Delivered population','REQ-000001',25,'ACKNOWLEDGED'
                            FROM generate_series(1,?)
                            """,
                            first,
                            delivered);
                    jdbc.execute("ANALYZE tasks");
                    jdbc.execute("ANALYZE delivery_queue");
                    clearInvocations(observedSql);
                    for (int n = 0; n < 30; n++) assertNull(exchanges.lockDueExchange());
                    String sql = claimSql();
                    ready(20000);
                    assertNotNull(exchanges.lockDueExchange());
                    var names =
                            jdbc.queryForList(
                                    "SELECT name FROM pg_prepared_statements WHERE statement = ?", String.class, sql);
                    // Explain the path actually used by the driver, including a server-cached
                    // empty-queue plan if one exists; a fresh EXPLAIN would hide that regression.
                    String execution =
                            names.isEmpty() ? sql : "EXECUTE \"" + names.getFirst().replace("\"", "\"\"") + "\"";
                    var plan =
                            json.readTree(
                                    jdbc.queryForObject(
                                            "EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) " + execution, String.class));
                    assertEquals(1, plan.get(0).get("Plan").get("Actual Rows").asInt());
                    var fresh =
                            json.readTree(
                                    jdbc.queryForObject(
                                            "EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) " + sql, String.class));
                    assertEquals(
                            fresh.findValues("Plan Rows"),
                            plan.findValues("Plan Rows"),
                            "The driver must use current estimates after queue growth, not its empty-queue estimates");
                    tx.setRollbackOnly();
                });
    }

    @Test
    void sequentialQueuePlansLockOnlyTheSelectedTaskAndSkipAnAlreadyLockedTask() {
        ready(3);
        new TransactionTemplate(transactions)
                .executeWithoutResult(tx -> {
                    jdbc.execute("SET LOCAL enable_indexscan=off");
                    jdbc.execute("SET LOCAL enable_bitmapscan=off");
                    var selected = exchanges.lockDueExchange();
                    assertNotNull(selected);
                    UUID neighbor =
                            jdbc.queryForObject(
                                    "SELECT id FROM tasks WHERE id <> ? LIMIT 1", UUID.class, selected.task().id());
                    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
                        var next =
                                pool.submit(() ->
                                        new TransactionTemplate(transactions)
                                                .execute(other -> {
                                                    jdbc.queryForObject(
                                                            "SELECT id FROM tasks WHERE id=? FOR UPDATE NOWAIT",
                                                            UUID.class,
                                                            neighbor);
                                                    var claimed = exchanges.lockDueExchange();
                                                    assertNotNull(claimed);
                                                    assertNotEquals(selected.task().id(), claimed.task().id());
                                                    return claimed.task().id();
                                                }));
                        try {
                            assertNotEquals(selected.task().id(), next.get(5, TimeUnit.SECONDS));
                        } catch (Exception error) {
                            throw new AssertionError("An unrelated due task must remain available", error);
                        }
                    }
                    tx.setRollbackOnly();
                });
    }

    private void ready(int count) {
        jdbc.update(
                """
                WITH fresh AS (
                    INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity)
                    SELECT gen_random_uuid(),?,gen_random_uuid(),'Due task','REQ-000002',25
                    FROM generate_series(1,?) RETURNING operation_id
                )
                INSERT INTO delivery_queue(operation_id,due_at)
                SELECT operation_id,clock_timestamp()-interval '1 hour' FROM fresh
                """,
                first,
                count);
    }

    private String claimSql() {
        return mockingDetails(observedSql).getInvocations().stream()
                .filter(call ->
                        call.getMethod().getName().equals("query")
                                && call.getArguments()[0] instanceof String value
                                && value.contains("SKIP LOCKED"))
                .map(call -> (String) call.getArguments()[0])
                .findFirst()
                .orElseThrow();
    }

    private double rowsVisited(JsonNode node, String relation) {
        double result = 0;
        if (node.isObject() && node.path("Relation Name").asString("").equals(relation)) {
            result +=
                    (node.path("Actual Rows").asDouble() + node.path("Rows Removed by Filter").asDouble())
                            * node.path("Actual Loops").asDouble();
        }
        for (var child : node) result += rowsVisited(child, relation);
        return result;
    }
}
