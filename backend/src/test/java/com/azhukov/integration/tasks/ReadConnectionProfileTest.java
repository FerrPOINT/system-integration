package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.service.TaskService;
import com.azhukov.integration.support.PostgresTest;
import com.azhukov.integration.support.ReadSqlCapture;
import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/** Native PostgreSQL read costs, including the connection boundary; not a capacity qualification. */
@Import(ReadSqlCapture.class)
class ReadConnectionProfileTest extends PostgresTest {
    @Autowired TaskService tasks;
    @Autowired DataSource source;

    @Test
    void profilesCompleteCountedReadsAndSeparatesTheObserverOverhead() throws Exception {
        jdbc.update(
                """
                INSERT INTO tasks(id,owner_id,operation_id,title,request_quantity,
                    delivery_status,business_status,created_at,accepted_result)
                SELECT id,CASE WHEN n%2=0 THEN ?::uuid ELSE ?::uuid END,operation_id,
                    'Read profile '||n,25,'ACKNOWLEDGED','SUCCEEDED',
                    '2026-11-10T12:00:00Z'::timestamptz+n*interval '1 millisecond',
                    jsonb_build_object('operationId',operation_id,'request',
                        jsonb_build_object('quantity',25),
                        'version',2,'status','SUCCEEDED','completedAt','2026-11-10T12:01:00Z')
                FROM (SELECT n,gen_random_uuid() AS id,gen_random_uuid() AS operation_id
                    FROM generate_series(1,5000) n) fixture
                """,
                first, second);
        var actor = new Actor(first, Actor.Role.INITIATOR);
        for (int n = 0; n < 50; n++) tasks.list(actor, 0, 20, BusinessStatus.SUCCEEDED, null, null);
        var samples = new ArrayList<ReadSqlCapture.Timings>();
        for (int n = 0; n < 200; n++) {
            var captured = ReadSqlCapture.record(() -> tasks.list(actor, 0, 20, BusinessStatus.SUCCEEDED, null, null));
            assertEquals(2500, captured.value().totalItems());
            assertEquals(20, captured.value().items().size());
            assertTrue(captured.value().items().stream().allMatch(task -> task.outcome() != null));
            assertEquals(2, captured.statements().size());
            complete(captured.timings());
            samples.add(captured.timings());
        }
        var target = Path.of("../tests/results/read-connection-profile.json");
        Files.createDirectories(target.getParent());
        Files.writeString(
                target,
                json.writerWithDefaultPrettyPrinter()
                        .writeValueAsString(
                                Map.of(
                                        "scope",
                                        "native PostgreSQL, single client, 5000 synthetic completed rows; not container capacity",
                                        "warmupReads",
                                        50,
                                        "measuredReads",
                                        samples.size(),
                                        "units",
                                        "nanoseconds; wall/SQL timings are not CPU; observer includes driver parameter metadata",
                                        "samples",
                                        samples)));
    }

    @Test
    void acquisitionTimingIncludesActualWaitingForTheExhaustedPool() throws Exception {
        var hikari = source.unwrap(HikariDataSource.class);
        var held = new ArrayList<java.sql.Connection>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                for (int n = 0; n < hikari.getMaximumPoolSize(); n++) held.add(source.getConnection());
                var waiting =
                        executor.submit(() ->
                                ReadSqlCapture.record(() ->
                                        tasks.list(new Actor(first, Actor.Role.INITIATOR), 0, 20, null, null, null)));
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
                while (hikari.getHikariPoolMXBean().getThreadsAwaitingConnection() == 0) {
                    if (System.nanoTime() >= deadline) fail("The service did not reach the exhausted pool");
                    Thread.sleep(1);
                }
                long observedWait = System.nanoTime();
                Thread.sleep(Duration.ofMillis(25));
                long releasedAt = System.nanoTime();
                held.removeLast().close();
                var captured = waiting.get(5, TimeUnit.SECONDS);
                assertTrue(captured.timings().acquisitionNanos() >= releasedAt - observedWait);
                complete(captured.timings());
                assertEquals(0, captured.value().totalItems());
            } finally {
                for (var connection : held) connection.close();
            }
        }
    }

    private void complete(ReadSqlCapture.Timings timing) {
        assertEquals(1, timing.acquiredConnections());
        assertEquals(
                1, timing.closedConnections(), "The owning service must return the connection before capture ends");
        assertTrue(timing.wallNanos() >= timing.acquisitionNanos() + timing.connectionNanos());
        assertTrue(
                timing.connectionNanos() >= timing.readExecuteNanos() + timing.commitNanos() + timing.observerNanos());
        assertTrue(timing.readExecuteNanos() > 0);
        assertTrue(timing.commitNanos() > 0);
    }
}
