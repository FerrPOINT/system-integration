package db.migration;

import com.azhukov.integration.json.ContentFingerprint;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Migrate persisted documents and fingerprints together before dropping the reference column. */
public class V15__NormalizeOperationRequests extends BaseJavaMigration {
    private static final String RENAME_PREFIX = "Название изменено: «";
    private static final String RENAME_SEPARATOR = "» → «";

    private final JsonMapper json = JsonMapper.builder().build();

    @Override
    public void migrate(Context context) {
        var jdbc = new JdbcTemplate(new SingleConnectionDataSource(context.getConnection(), true));
        migrateCreateReceipts(jdbc);
        migrateIssues(jdbc);

        // An old comparison based on different inputs must not authorize a new command.
        jdbc.update(
                """
                UPDATE tasks AS t
                SET exchange_version = exchange_version + 1
                WHERE EXISTS (
                    SELECT 1 FROM reconciliations r
                    JOIN exchange_issues i ON i.latest_reconciliation_id = r.id AND i.status = 'OPEN'
                    WHERE r.task_id = t.id AND r.exchange_version = t.exchange_version
                      AND r.snapshot #>> '{local,request,reference}'
                           <> r.snapshot #>> '{external,request,reference}'
                )
                """);

        jdbc.execute("ALTER TABLE reconciliations DISABLE TRIGGER reconciliation_immutable");
        jdbc.query(
                "SELECT id,snapshot::text FROM reconciliations WHERE snapshot #> '{local,request,reference}' IS NOT NULL",
                rs -> {
                    jdbc.update(
                            "UPDATE reconciliations SET snapshot=?::jsonb WHERE id=?",
                            json.writeValueAsString(reconciliation(rs.getString(2))),
                            rs.getObject(1));
                });
        jdbc.execute("ALTER TABLE reconciliations ENABLE TRIGGER reconciliation_immutable");

        jdbc.execute("ALTER TABLE task_history DISABLE TRIGGER history_immutable");
        jdbc.query(
                "SELECT id,observed_result::text,observation_fingerprint FROM task_history WHERE observed_result IS NOT NULL",
                rs -> {
                    var result = json.readTree(rs.getString(2));
                    String original = rs.getString(3);
                    if (original != null && !original.equals(hash(result)))
                        throw new IllegalStateException(
                                "Observation fingerprint could not be verified: " + rs.getObject(1));
                    removeReference(result);
                    jdbc.update(
                            "UPDATE task_history SET observed_result=?::jsonb,observation_fingerprint=? WHERE id=?",
                            json.writeValueAsString(result),
                            original == null ? null : hash(result),
                            rs.getObject(1));
                });
        jdbc.execute("ALTER TABLE task_history ENABLE TRIGGER history_immutable");

        jdbc.query(
                """
                SELECT actor_id,command_type,idempotency_key,response_body::text
                FROM command_receipts
                WHERE command_type IN ('RECONCILE','TAKE_ISSUE')
                """,
                rs -> {
                    String command = rs.getString(2);
                    var body =
                            command.equals("RECONCILE")
                                    ? reconciliation(rs.getString(4))
                                    : evidenceInReceipt(rs.getString(4));
                    jdbc.update(
                            """
                            UPDATE command_receipts SET response_body=?::jsonb
                            WHERE actor_id=? AND command_type=? AND idempotency_key=?
                            """,
                            json.writeValueAsString(body),
                            rs.getObject(1),
                            command,
                            rs.getObject(3));
                });

        jdbc.update(
                """
                UPDATE tasks SET accepted_result = accepted_result #- '{request,reference}'
                WHERE accepted_result IS NOT NULL
                """);
        jdbc.execute("ALTER TABLE tasks DROP COLUMN request_reference");
    }

    private void migrateCreateReceipts(JdbcTemplate jdbc) {
        jdbc.query(
                """
                SELECT c.actor_id,c.idempotency_key,c.fingerprint,t.id,t.title,t.request_quantity,t.request_reference,
                       h.summary
                FROM command_receipts c
                LEFT JOIN tasks t ON t.id = (c.response_body->>'taskId')::uuid AND t.owner_id = c.actor_id
                LEFT JOIN LATERAL (
                    SELECT summary FROM task_history
                    WHERE task_id = t.id AND event_type = 'RENAMED'
                    ORDER BY occurred_at,id LIMIT 1
                ) h ON true
                WHERE c.command_type = 'CREATE_TASK'
                """,
                rs -> {
                    UUID task = rs.getObject(4, UUID.class);
                    if (task == null)
                        throw new IllegalStateException("Create receipt does not identify its owner's task");
                    int quantity = rs.getInt(6);
                    String title =
                            originalTitle(rs.getString(3), rs.getString(5), quantity, rs.getString(7), rs.getString(8));
                    if (title == null)
                        throw new IllegalStateException("Original create input could not be verified for task " + task);
                    jdbc.update(
                            """
                            UPDATE command_receipts SET fingerprint=?
                            WHERE actor_id=? AND command_type='CREATE_TASK' AND idempotency_key=?
                            """,
                            hash(Map.of("title", title, "quantity", quantity)),
                            rs.getObject(1),
                            rs.getObject(2));
                });
    }

    private String originalTitle(
            String fingerprint, String current, int quantity, String reference, String firstRename) {
        var request = Map.of("quantity", quantity, "reference", reference);
        if (hash(Map.of("title", current, "request", request)).equals(fingerprint)) return current;
        if (firstRename == null || !firstRename.startsWith(RENAME_PREFIX)) return null;
        int from = RENAME_PREFIX.length();
        // Titles may themselves contain the separator. Only a verified hash identifies the original title.
        for (int end = firstRename.indexOf(RENAME_SEPARATOR, from);
                end >= 0;
                end = firstRename.indexOf(RENAME_SEPARATOR, end + RENAME_SEPARATOR.length())) {
            String candidate = firstRename.substring(from, end);
            if (hash(Map.of("title", candidate, "request", request)).equals(fingerprint)) return candidate;
        }
        return null;
    }

    private void migrateIssues(JdbcTemplate jdbc) {
        jdbc.query(
                """
                SELECT id,scope,fingerprint,summary,evidence::text
                FROM exchange_issues ORDER BY opened_at,id
                """,
                rs -> {
                    var evidence = (ObjectNode) json.readTree(rs.getString(5));
                    var oldReceived = evidence.path("received").deepCopy();
                    String oldFingerprint = rs.getString(3);
                    String reason = rs.getString(4);
                    String difference = difference(evidence.path("local"), evidence.path("received"));
                    normalizeEvidence(evidence);
                    String fingerprint = oldFingerprint;
                    if (difference == null
                            && oldReceived.isObject()
                            && oldFingerprint.equals(hash(Arrays.asList(reason, oldReceived))))
                        fingerprint = hash(Arrays.asList(reason, evidence.path("received")));
                    UUID id = rs.getObject(1, UUID.class);
                    jdbc.update(
                            "UPDATE exchange_issues SET evidence=?::jsonb WHERE id=?",
                            json.writeValueAsString(evidence),
                            id);
                    if (!fingerprint.equals(oldFingerprint))
                        jdbc.update(
                                """
                                UPDATE exchange_issues SET fingerprint=?
                                WHERE id=? AND NOT EXISTS (SELECT 1 FROM exchange_issues WHERE scope=? AND fingerprint=?)
                                """,
                                fingerprint,
                                id,
                                rs.getString(2),
                                fingerprint);
                });
    }

    private JsonNode reconciliation(String value) {
        var body = (ObjectNode) json.readTree(value);
        String note = difference(body.path("local"), body.path("external"));
        if (note != null) body.put("diagnostic", note);
        removeReference(body.path("local"));
        removeReference(body.path("external"));
        removeReference(body.path("external").path("result"));
        return body;
    }

    private JsonNode evidenceInReceipt(String value) {
        var body = json.readTree(value);
        if (body.path("evidence") instanceof ObjectNode evidence) normalizeEvidence(evidence);
        return body;
    }

    private void normalizeEvidence(ObjectNode evidence) {
        String note = difference(evidence.path("local"), evidence.path("received"));
        if (note != null) evidence.put("reason", evidence.path("reason").asString("") + " " + note);
        removeReference(evidence.path("local"));
        removeReference(evidence.path("received"));
    }

    private static String difference(JsonNode local, JsonNode external) {
        var left = local.path("request").path("reference");
        var right = external.path("request").path("reference");
        if (!left.isString() || !right.isString() || left.equals(right)) return null;
        return "При проверке номера заявки различались: в приложении — %s, у исполнителя — %s."
                .formatted(left.asString(), right.asString());
    }

    private static void removeReference(JsonNode document) {
        if (document.path("request") instanceof ObjectNode request) request.remove("reference");
    }

    private String hash(Object value) {
        return ContentFingerprint.of(json, value);
    }
}
