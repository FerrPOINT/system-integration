package com.azhukov.emulator;

import com.azhukov.integration.contract.external.model.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Repository
class OperationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    OperationRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    private final RowMapper<OperationState> operationRow = this::mapOperation;

    private OperationState mapOperation(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new OperationState()
        .operationId(rs.getObject("id", UUID.class))
        .request(new OperationInput(rs.getString("reference"), rs.getInt("quantity")))
        .acceptedAt(rs.getObject("accepted_at", OffsetDateTime.class))
        .executions(OperationState.ExecutionsEnum.fromValue(rs.getInt("executions")))
        .result(rs.getString("result") == null ? null : json.readValue(rs.getString("result"), Result.class));
    }

    OperationState get(UUID id) {
        return jdbc.query("SELECT * FROM operations WHERE id = ?", operationRow, id).stream().findFirst()
            .orElseThrow(() -> new EmulatorProblem(404, "OPERATION_NOT_FOUND"));
    }

    List<OperationState> lockNext() {
        return jdbc.query("SELECT * FROM operations WHERE executions = 0 ORDER BY accepted_at,id LIMIT 1 FOR UPDATE SKIP LOCKED", operationRow);
    }

    List<ResultEvent> events(long after, int limit) {
        return jdbc.query("SELECT cursor,payload::text FROM result_events WHERE cursor > ? ORDER BY cursor LIMIT ?",
            (rs,n) -> new ResultEvent(rs.getLong("cursor"), json.readValue(rs.getString("payload"), Result.class)), after, limit);
    }

    String fault(UUID id) {
        return jdbc.query("SELECT mode FROM faults WHERE bound_operation_id = ? FOR UPDATE", (rs,n) -> rs.getString(1), id)
            .stream().findFirst().orElse("");
    }

    void event(Result result, int copy, boolean held) {
        jdbc.update("""
            INSERT INTO result_events(operation_id,version,copy_number,payload,publish_after)
            VALUES (?,?,?,?::jsonb,CASE WHEN ? THEN NULL ELSE clock_timestamp() END)
            """, result.getOperationId(), result.getVersion().getValue(), copy, json.writeValueAsString(result), held);
    }

    void lockOperation(UUID id) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", rs -> {}, id.toString());
    }

    boolean exists(UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM operations WHERE id = ?)",Boolean.class,id));
    }

    record Fault(String mode, UUID bound) {}

    Fault lockFault(String reference) {
        return jdbc.query("SELECT mode,bound_operation_id FROM faults WHERE reference = ? FOR UPDATE",
            (rs,n) -> new Fault(rs.getString(1),rs.getObject(2,UUID.class)),reference).stream().findFirst().orElse(null);
    }

    void insert(UUID id, OperationInput input) {
        jdbc.update("INSERT INTO operations(id,reference,quantity) VALUES (?,?,?)",id,input.getReference(),input.getQuantity());
    }

    void bindFault(String reference, UUID id) {
        jdbc.update("UPDATE faults SET bound_operation_id = ? WHERE reference = ?",id,reference);
    }

    void complete(Result result) {
        jdbc.update("UPDATE operations SET executions = 1,result = ?::jsonb,completed_at = ? WHERE id = ?",
            json.writeValueAsString(result),result.getCompletedAt(),result.getOperationId());
    }

    boolean publishNext() {
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

    void lockFaultConfiguration(String reference) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",rs -> {},"fault:" + reference);
    }

    void configure(String reference, String mode) {
        jdbc.update("INSERT INTO faults(reference,mode) VALUES (?,?) ON CONFLICT(reference) DO UPDATE SET mode = excluded.mode",reference,mode);
    }

    void clear(String reference) {
        var fault = lockFault(reference);
        if (fault != null && fault.bound() != null)
            jdbc.update("UPDATE result_events SET publish_after = clock_timestamp() WHERE operation_id = ? AND cursor IS NULL",fault.bound());
        jdbc.update("DELETE FROM faults WHERE reference = ?",reference);
    }

    private record EventKey(UUID id, int version, int copy) {}
}
