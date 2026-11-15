package com.azhukov.emulator;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.emulator.service.OperationService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

/** Fixed-data algorithm comparison outside cgroup limits; not a capacity qualification. */
@Tag("postgres")
@SpringBootTest(properties = "si.emulator.worker.enabled=false")
class ExecutionProfileTest {
    @Autowired OperationService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", () -> "jdbc:postgresql://127.0.0.1:19632/si_emulator_test");
        properties.add("spring.datasource.username", () -> "si_emulator_test");
        properties.add("spring.datasource.password", () -> System.getenv("SI_EMULATOR_TEST_DB_PASSWORD"));
    }

    @Test
    void compareBoundedExecutionTransactionsOnIdenticalData() throws Exception {
        assertEquals("si_emulator_test", jdbc.queryForObject("SELECT current_database()", String.class));
        var results = new ArrayList<Map<String, Object>>();
        int[][] orders = {{1, 5, 10, 25}, {25, 10, 5, 1}, {10, 1, 25, 5}};
        try {
            for (int round = 0; round < orders.length; round++) {
                for (int batch : orders[round]) {
                    clean();
                    jdbc.update(
                            """
                            INSERT INTO operations(id,reference,quantity,accepted_at)
                            SELECT md5('execution-profile:'||i)::uuid,'REQ-'||(710000+i),25,
                                '2026-11-15'::timestamptz+i*interval '1 millisecond'
                            FROM generate_series(1,1000) i
                            """);
                    var times = new ArrayList<Long>();
                    long start = System.nanoTime();
                    int executed = 0, count;
                    do {
                        long before = System.nanoTime();
                        count = service.executeNext(batch);
                        times.add(System.nanoTime() - before);
                        executed += count;
                    } while (count > 0);
                    long elapsed = System.nanoTime() - start;
                    assertEquals(1000, executed);
                    assertEquals(
                            1000,
                            jdbc.queryForObject("SELECT count(*) FROM operations WHERE executions=1", Integer.class));
                    assertEquals(2000, jdbc.queryForObject("SELECT count(*) FROM result_events", Integer.class));
                    Collections.sort(times);
                    results.add(
                            Map.of(
                                    "round",
                                    round + 1,
                                    "batch",
                                    batch,
                                    "transactions",
                                    times.size(),
                                    "elapsedMs",
                                    elapsed / 1e6,
                                    "transactionP95Ms",
                                    times.get((int) Math.ceil(times.size() * .95) - 1) / 1e6));
                }
            }
            var output = Path.of("../tests/results/execution-profile.json");
            Files.createDirectories(output.getParent());
            Files.writeString(output, json.writeValueAsString(results));
        } finally {
            clean();
        }
    }

    private void clean() {
        jdbc.execute("TRUNCATE result_events,faults,operations CASCADE");
        jdbc.update("UPDATE feed_position SET last_cursor=0 WHERE id=1");
    }
}
