package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.support.PostgresTest;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

class FeedPauseMigrationTest extends PostgresTest {
    @Test
    void v13MovesOnlyWholePageIncidentsAndPreservesDecisions() throws Exception {
        String schema = "feed_pause_" + UUID.randomUUID().toString().replace("-", "");
        String url = "jdbc:postgresql://127.0.0.1:19632/si_test?currentSchema=" + schema;
        String password = System.getenv("SI_TEST_DB_PASSWORD");
        var flyway = Flyway.configure().dataSource(url, "si_test", password).schemas(schema).defaultSchema(schema);
        String reason = "Некорректная структура страницы или позиция ленты";
        try {
            flyway.target("12").load().migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var insert =
                            connection.prepareStatement(
                                    """
                                    INSERT INTO exchange_issues(id,scope,fingerprint,kind,summary,status,resolution,evidence)
                                    VALUES (?,'feed',?,'RESULT_CONFLICT',?,?,?::jsonb,'{"cursor":7}'::jsonb)
                                    """)) {
                for (int index = 0; index < 3; index++) {
                    insert.setObject(1, new UUID(0, index));
                    insert.setString(2, "fingerprint-" + index);
                    insert.setString(3, index == 2 ? "Входящий снимок не соответствует контракту" : reason);
                    insert.setString(4, index == 1 ? "RESOLVED" : "OPEN");
                    insert.setString(5, index == 1 ? "{\"reason\":\"Проверено\"}" : null);
                    assertEquals(1, insert.executeUpdate());
                }
            }
            flyway.target("13").load().migrate();
            try (var connection = DriverManager.getConnection(url, "si_test", password);
                    var sql = connection.createStatement();
                    var rows =
                            sql.executeQuery(
                                    """
                                    SELECT scope, fingerprint, status, coalesce(resolution->>'reason',''), evidence->>'cursor'
                                    FROM exchange_issues ORDER BY id
                                    """)) {
                var values = new ArrayList<List<String>>();
                while (rows.next()) {
                    values.add(
                            List.of(
                                    rows.getString(1),
                                    rows.getString(2),
                                    rows.getString(3),
                                    rows.getString(4),
                                    rows.getString(5)));
                }
                assertEquals(
                        List.of(
                                List.of("feed-page", "fingerprint-0", "OPEN", "", "7"),
                                List.of("feed-page", "fingerprint-1", "RESOLVED", "Проверено", "7"),
                                List.of("feed", "fingerprint-2", "OPEN", "", "7")),
                        values);
            }
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
