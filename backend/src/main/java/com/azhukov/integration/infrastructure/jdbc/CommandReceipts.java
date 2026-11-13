package com.azhukov.integration.infrastructure.jdbc;

import com.azhukov.integration.infrastructure.json.ContentFingerprint;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.application.port.CommandReceiptStore;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;
import java.util.Optional;
import java.util.function.Supplier;

@Repository
public class CommandReceipts implements CommandReceiptStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public CommandReceipts(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public <T> T execute(UUID actor, Command command, UUID key, Object input,
                         Class<T> type, Supplier<T> operation) {
        // The transaction lock also serializes a first command, before a receipt exists.
        // A hash collision only serializes unrelated commands; the full primary key decides identity.
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> {}, actor + ":" + command + ":" + key);
        String fingerprint = ContentFingerprint.of(json, input);
        var stored=read(actor,command,key);
        if (stored.isPresent()) return decode(stored.get(),fingerprint,type);
        T result = operation.get();
        jdbc.update("""
            INSERT INTO command_receipts (actor_id,command_type,idempotency_key,fingerprint,http_status,response_body)
            VALUES (?,?,?,?,?,?::jsonb)
            """, actor, command.name(), key, fingerprint, responseStatus(command), json.writeValueAsString(result));
        return result;
    }

    @Transactional(propagation=Propagation.MANDATORY)
    public <T> Optional<T> replay(UUID actor,Command command,UUID key,Object input,Class<T> type) {
        return read(actor,command,key).map(receipt -> decode(receipt,ContentFingerprint.of(json,input),type));
    }

    private Optional<Receipt> read(UUID actor,Command command,UUID key) {
        return jdbc.query("""
            SELECT fingerprint, response_body::text FROM command_receipts
            WHERE actor_id = ? AND command_type = ? AND idempotency_key = ?
            """,(rs,row) -> new Receipt(rs.getString(1),rs.getString(2)),actor,command.name(),key).stream().findFirst();
    }

    private <T> T decode(Receipt receipt,String fingerprint,Class<T> type) {
        if (!receipt.fingerprint().equals(fingerprint))
            throw new RuleViolation(RuleViolation.Code.IDEMPOTENCY_CONFLICT,"Ключ уже использован для другой команды");
        return json.readValue(receipt.body(),type);
    }

    private static int responseStatus(Command command) {
        return switch (command) {
            case CREATE_TASK -> 201;
            case RENAME_TASK, RECONCILE, TAKE_ISSUE, RETRY_EXCHANGE, RESOLVE_ISSUE -> 200;
        };
    }

    private record Receipt(String fingerprint, String body) {}
}
