package com.azhukov.integration.tasks;

import com.azhukov.integration.domain.RuleViolation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.util.function.Supplier;

@Component
public class CommandReceipts {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public CommandReceipts(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public <T> T execute(UUID actor, String command, UUID key, Object input,
                         int status, Class<T> type, Supplier<T> operation) {
        // The transaction lock also serializes a first command, before a receipt exists.
        // A hash collision only serializes unrelated commands; the full primary key decides identity.
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> {}, actor + ":" + command + ":" + key);
        String fingerprint = ContentFingerprint.of(json, input);
        var stored = jdbc.query("""
            SELECT fingerprint, response_body::text FROM command_receipts
            WHERE actor_id = ? AND command_type = ? AND idempotency_key = ?
            """, (rs, row) -> new Receipt(rs.getString(1), rs.getString(2)), actor, command, key);
        if (!stored.isEmpty()) {
            var receipt = stored.getFirst();
            if (!receipt.fingerprint().equals(fingerprint))
                throw new RuleViolation(RuleViolation.Code.IDEMPOTENCY_CONFLICT, "Ключ уже использован для другой команды");
            return json.readValue(receipt.body(), type);
        }
        T result = operation.get();
        jdbc.update("""
            INSERT INTO command_receipts (actor_id,command_type,idempotency_key,fingerprint,http_status,response_body)
            VALUES (?,?,?,?,?,?::jsonb)
            """, actor, command, key, fingerprint, status, json.writeValueAsString(result));
        return result;
    }

    private record Receipt(String fingerprint, String body) {}
}
