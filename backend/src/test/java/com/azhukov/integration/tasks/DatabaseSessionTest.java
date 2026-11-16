package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import java.sql.SQLException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class DatabaseSessionTest extends PostgresTest {
    @Autowired ExchangeService exchange;

    @Test
    void configuredIdleProtectionDoesNotImposeAnActiveQueryBudget() throws Exception {
        try (var connection = jdbc.getDataSource().getConnection();
                var sql = connection.createStatement()) {
            try (var settings =
                    sql.executeQuery(
                            "SELECT current_setting('idle_in_transaction_session_timeout') <> '0',current_setting('statement_timeout'),current_setting('lock_timeout')")) {
                assertTrue(settings.next());
                assertTrue(settings.getBoolean(1));
                assertEquals("0", settings.getString(2));
                assertEquals("0", settings.getString(3));
            }
            connection.setAutoCommit(false);
            sql.execute("SET LOCAL idle_in_transaction_session_timeout = '250ms'");
            sql.execute("SELECT pg_sleep(0.5)");
            sql.execute("SELECT 1");
            connection.commit();
        }
    }

    @Test
    void abandonedIdleTransactionRollsBackAndReleasesTheWaitingWriter() throws Exception {
        try (var blocker = jdbc.getDataSource().getConnection();
                var sql = blocker.createStatement();
                var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            blocker.setAutoCommit(false);
            sql.execute("SET LOCAL idle_in_transaction_session_timeout = '1s'");
            sql.executeUpdate("UPDATE users SET username='uncommitted.name' WHERE username='initiator.one'");
            var waiting = pool.submit(() -> jdbc.update("UPDATE users SET username=username WHERE id=?", first));
            var deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(750);
            boolean observed = false;
            while (System.nanoTime() < deadline && !waiting.isDone()) {
                var activity = exchange.databaseActivity();
                if (activity.blockedSessions() > 0 && activity.idleTransactions() > 0) {
                    observed = true;
                    break;
                }
                Thread.sleep(10);
            }
            assertTrue(observed, "An explicit diagnostic must expose both the waiter and idle holder");
            assertEquals(1, waiting.get(5, TimeUnit.SECONDS));
            assertThrows(SQLException.class, () -> sql.execute("SELECT 1"));
        }
        assertEquals(
                "initiator.one", jdbc.queryForObject("SELECT username FROM users WHERE id=?", String.class, first));
    }
}
