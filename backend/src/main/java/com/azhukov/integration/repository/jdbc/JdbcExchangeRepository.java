package com.azhukov.integration.repository.jdbc;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.repository.ExchangeRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * Explicit queue/lease and result SQL. SKIP LOCKED claims commit before HTTP;
 * finish verifies the unexpired claim. Ordered locks preserve atomic result/cursor
 * changes. See ExchangeRepository for caller transaction obligations.
 */
@Repository
@RequiredArgsConstructor
public class JdbcExchangeRepository implements ExchangeRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TaskRowMapper rowMapper;

    public ExchangeState exchange(UUID operationId, boolean lock) {
        return jdbc.query("SELECT * FROM tasks WHERE operation_id = ?" + (lock ? " FOR UPDATE" : ""),
            rowMapper::exchange, operationId)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public Map<UUID,ExchangeState> exchangeByTask(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        var placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT * FROM tasks WHERE id IN (" + placeholders + ")", rowMapper::exchange, ids.toArray())
            .stream().collect(java.util.stream.Collectors.toMap(row -> row.task().id(), row -> row));
    }

    public Map<UUID,ExchangeState> lockExchanges(List<UUID> operationIds) {
        if (operationIds.isEmpty()) return Map.of();
        if (operationIds.size()>100) throw new IllegalArgumentException("A feed page cannot exceed 100 operations");
        var placeholders=String.join(",",java.util.Collections.nCopies(operationIds.size(),"?"));
        return jdbc.query("SELECT * FROM tasks WHERE operation_id IN ("+placeholders+") ORDER BY id FOR UPDATE",
            rowMapper::exchange,operationIds.toArray()).stream()
            .collect(java.util.stream.Collectors.toMap(row -> row.task().operationId(),row -> row));
    }

    public void enqueue(UUID operationId) {
        jdbc.update("INSERT INTO delivery_queue(operation_id) VALUES (?)", operationId);
    }

    public ExchangeState lockDueExchange() {
        return jdbc.query("""
            SELECT t.* FROM tasks t JOIN delivery_queue q ON q.operation_id = t.operation_id
            WHERE t.delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN') AND q.due_at <= statement_timestamp()
              AND (q.claim_id IS NULL OR q.claimed_until <= statement_timestamp())
            ORDER BY q.due_at,q.operation_id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
            """,rowMapper::exchange).stream().findFirst().orElse(null);
    }

    public Queue lockQueue(UUID id) {
        return jdbc.queryForObject("SELECT * FROM delivery_queue WHERE operation_id = ? FOR UPDATE",(rs,n) ->
            new Queue(rs.getString("next_step"),rs.getInt("attempts"),rs.getInt("automatic_attempts"),rs.getObject("claim_id",UUID.class),
                rs.getObject("claimed_until",OffsetDateTime.class)),id);
    }

    public void startAttempt(UUID operation, UUID claim, String step, int number) {
        jdbc.update("UPDATE delivery_queue SET claim_id = ?,claimed_until = clock_timestamp() + interval '15 seconds',attempts = ?,automatic_attempts = automatic_attempts + 1 WHERE operation_id = ?",claim,number,operation);
        jdbc.update("INSERT INTO delivery_attempts(id,operation_id,number,step) VALUES (?,?,?,?)",claim,operation,number,step);
    }

    public void finishAttempt(UUID id, String outcome) {
        jdbc.update("UPDATE delivery_attempts SET finished_at = clock_timestamp(),outcome = ? WHERE id = ? AND finished_at IS NULL",outcome,id);
    }

    public boolean ownsClaim(UUID operation, UUID claim) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM delivery_queue WHERE operation_id = ? AND claim_id = ? AND claimed_until > clock_timestamp())",Boolean.class,operation,claim));
    }

    public void scheduleAfterInterruptedClaim(UUID operation, OffsetDateTime expiredAt, int seconds) {
        jdbc.update("UPDATE delivery_queue SET claim_id = NULL,claimed_until = NULL,next_step = 'GET',due_at = ?::timestamptz + (? * interval '1 second') WHERE operation_id = ?",expiredAt,seconds,operation);
    }

    public void scheduleRetry(UUID operation, String step, int seconds) {
        jdbc.update("UPDATE delivery_queue SET next_step = ?,due_at = clock_timestamp() + (? * interval '1 second'),claim_id = NULL,claimed_until = NULL WHERE operation_id = ?",step,seconds,operation);
    }

    public void resumeDelivery(UUID operation) {
        jdbc.update("UPDATE delivery_queue SET automatic_attempts = 0,next_step = 'GET',due_at = clock_timestamp(),claim_id = NULL,claimed_until = NULL WHERE operation_id = ?",operation);
    }

    public void pauseQueue(UUID operation) {
        jdbc.update("UPDATE delivery_queue SET claim_id = NULL,claimed_until = NULL WHERE operation_id = ?",operation);
    }

    public void removeQueue(UUID operation) { jdbc.update("DELETE FROM delivery_queue WHERE operation_id = ?",operation); }

    public void delivery(UUID operation, DeliveryStatus status) {
        jdbc.update("UPDATE tasks SET delivery_status = ?,exchange_version = exchange_version + 1 WHERE operation_id = ? AND delivery_status <> ?",status.name(),operation,status.name());
    }

    public void applyResult(OperationResult result) {
        jdbc.update("UPDATE tasks SET accepted_result = ?::jsonb,business_status = ?,delivery_status = 'ACKNOWLEDGED',exchange_version = exchange_version + 1 WHERE operation_id = ?",
            json.writeValueAsString(result),result.status().name(),result.operationId());
    }

    public DeliveryBacklog backlog() {
        return jdbc.queryForObject("""
            SELECT count(*) AS operations,min(t.created_at) AS oldest_created_at
            FROM delivery_queue q JOIN tasks t ON t.operation_id=q.operation_id
            """,(rs,n) -> new DeliveryBacklog(rs.getLong("operations"),rs.getObject("oldest_created_at",OffsetDateTime.class)));
    }

    public long cursor(boolean lock) {
        return jdbc.queryForObject("SELECT last_cursor FROM incoming_position WHERE id = 1" + (lock ? " FOR UPDATE" : ""),Long.class);
    }

    public void advanceCursor(long cursor) { jdbc.update("UPDATE incoming_position SET last_cursor = ? WHERE id = 1",cursor); }
}
