package com.azhukov.emulator.infrastructure.jdbc;

import com.azhukov.emulator.application.port.OperationStore;
import com.azhukov.emulator.domain.*;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Repository
public class OperationRepository implements OperationStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public OperationRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    private final RowMapper<Operation> operationRow = this::mapOperation;

    private Operation mapOperation(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Operation(rs.getObject("id",UUID.class),
            new OperationRequest(rs.getString("reference"),rs.getInt("quantity")),
            rs.getObject("accepted_at",OffsetDateTime.class),rs.getInt("executions"),
            rs.getString("result")==null ? null : json.readValue(rs.getString("result"),OperationResult.class));
    }

    public Operation get(UUID id) {
        return jdbc.query("SELECT * FROM operations WHERE id = ?", operationRow, id).stream().findFirst()
            .orElseThrow(() -> new RuleViolation(RuleViolation.Code.OPERATION_NOT_FOUND));
    }

    public List<Operation> lockNext() {
        return jdbc.query("SELECT * FROM operations WHERE executions = 0 ORDER BY accepted_at,id LIMIT 1 FOR UPDATE SKIP LOCKED", operationRow);
    }

    public List<ResultEvent> events(long after, int limit) {
        return jdbc.query("SELECT cursor,payload::text FROM result_events WHERE cursor > ? ORDER BY cursor LIMIT ?",
            (rs,n) -> new ResultEvent(rs.getLong("cursor"), json.readValue(rs.getString("payload"), OperationResult.class)), after, limit);
    }

    public FaultMode fault(UUID id) {
        return jdbc.query("SELECT mode FROM faults WHERE bound_operation_id = ? FOR UPDATE", (rs,n) -> FaultMode.valueOf(rs.getString(1)), id)
            .stream().findFirst().orElse(FaultMode.NONE);
    }

    public void event(OperationResult result, int copy, boolean held) {
        jdbc.update("""
            INSERT INTO result_events(operation_id,version,copy_number,payload,publish_after)
            VALUES (?,?,?,?::jsonb,CASE WHEN ? THEN NULL ELSE clock_timestamp() END)
            """, result.operationId(), result.version(), copy, json.writeValueAsString(result), held);
    }

    public void lockOperation(UUID id) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> {}, id.toString());
    }

    public boolean exists(UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM operations WHERE id = ?)",Boolean.class,id));
    }

    public Fault lockFault(String reference) {
        return jdbc.query("SELECT mode,bound_operation_id FROM faults WHERE reference = ? FOR UPDATE",
            (rs,n) -> new Fault(FaultMode.valueOf(rs.getString(1)),rs.getObject(2,UUID.class)),reference).stream().findFirst().orElse(null);
    }

    public void insert(UUID id, OperationRequest input) {
        jdbc.update("INSERT INTO operations(id,reference,quantity) VALUES (?,?,?)",id,input.reference(),input.quantity());
    }

    public void bindFault(String reference, UUID id) {
        jdbc.update("UPDATE faults SET bound_operation_id = ? WHERE reference = ?",id,reference);
    }

    public void complete(OperationResult result) {
        jdbc.update("UPDATE operations SET executions = 1,result = ?::jsonb,completed_at = ? WHERE id = ?",
            json.writeValueAsString(result),result.completedAt(),result.operationId());
    }

    public boolean publishNext() {
        // Holding the counter until commit makes cursor order equal commit order.
        long previous = jdbc.queryForObject("SELECT last_cursor FROM feed_position WHERE id = 1 FOR UPDATE",Long.class);
        var events = jdbc.query("""
            SELECT e.operation_id,e.version,e.copy_number FROM result_events e
            WHERE e.cursor IS NULL AND (e.publish_after <= clock_timestamp() OR
                (e.version = 1 AND EXISTS (SELECT 1 FROM faults f WHERE f.bound_operation_id = e.operation_id AND f.mode = 'DELAY_RESULT')
                AND EXISTS (SELECT 1 FROM result_events terminal WHERE terminal.operation_id = e.operation_id AND terminal.version = 2 AND terminal.cursor IS NOT NULL)))
            ORDER BY e.created_at,e.version,e.copy_number LIMIT 1 FOR UPDATE OF e
            """,(rs,n) -> new EventKey(rs.getObject(1,UUID.class),rs.getInt(2),rs.getInt(3)));
        if (events.isEmpty()) return false;
        long next = Math.addExact(previous,1);
        var event = events.getFirst();
        jdbc.update("UPDATE result_events SET cursor = ? WHERE operation_id = ? AND version = ? AND copy_number = ?",
            next,event.id(),event.version(),event.copy());
        jdbc.update("UPDATE feed_position SET last_cursor = ? WHERE id = 1",next);
        return true;
    }

    public void lockFaultConfiguration(String reference) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",rs -> {},"fault:" + reference);
    }

    public void configure(String reference, FaultMode mode) {
        jdbc.update("INSERT INTO faults(reference,mode) VALUES (?,?) ON CONFLICT(reference) DO UPDATE SET mode = excluded.mode",reference,mode.name());
    }

    public void releaseEvents(UUID operation) {
        jdbc.update("UPDATE result_events SET publish_after = clock_timestamp() WHERE operation_id = ? AND cursor IS NULL",operation);
    }

    public void clearFault(String reference) {
        jdbc.update("DELETE FROM faults WHERE reference = ?",reference);
    }

    private record EventKey(UUID id, int version, int copy) {}
}
