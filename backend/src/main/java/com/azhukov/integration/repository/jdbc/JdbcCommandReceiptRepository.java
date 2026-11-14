package com.azhukov.integration.repository.jdbc;

import com.azhukov.integration.dto.CommandType;
import com.azhukov.integration.repository.CommandReceiptRepository;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@RequiredArgsConstructor
public class JdbcCommandReceiptRepository implements CommandReceiptRepository {
    private final JdbcTemplate jdbc;

    @Override
    public void lock(UUID actor, CommandType command, UUID key) {
        // Serialize the first command too. The full primary key decides identity;
        // an advisory hash collision only serializes unrelated commands.
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> {}, actor + ":" + command + ":" + key);
    }

    @Override
    public Optional<Receipt> find(UUID actor, CommandType command, UUID key) {
        return jdbc.query("""
            SELECT fingerprint, response_body::text FROM command_receipts
            WHERE actor_id = ? AND command_type = ? AND idempotency_key = ?
            """, (rs,row) -> new Receipt(rs.getString(1),rs.getString(2)), actor,command.name(),key).stream().findFirst();
    }

    @Override
    public void insert(UUID actor, CommandType command, UUID key, String fingerprint, int status, String body) {
        jdbc.update("""
            INSERT INTO command_receipts (actor_id,command_type,idempotency_key,fingerprint,http_status,response_body)
            VALUES (?,?,?,?,?,?::jsonb)
            """, actor,command.name(),key,fingerprint,status,body);
    }
}
