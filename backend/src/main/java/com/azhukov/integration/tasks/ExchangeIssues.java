package com.azhukov.integration.tasks;

import com.azhukov.integration.application.port.TaskStore;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.RuleViolation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.time.OffsetDateTime;

@Repository
public class ExchangeIssues {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TaskStore tasks;

    public ExchangeIssues(JdbcTemplate jdbc, ObjectMapper json, TaskStore tasks) {
        this.jdbc = jdbc; this.json = json; this.tasks = tasks;
    }

    public UUID open(ExchangeState state, UUID operationId, String kind, String reason,
                     Object content, OperationResult received, Long cursor) {
        var scope = operationId == null ? "feed" : operationId.toString();
        var fingerprint = ContentFingerprint.of(json, java.util.Arrays.asList(reason, content));
        var evidence = new LinkedHashMap<String,Object>();
        evidence.put("reason", reason);
        if (cursor != null) evidence.put("cursor", cursor);
        if (state != null) evidence.put("local", snapshot(state));
        if (received != null) evidence.put("received", received);
        UUID id = UUID.randomUUID();
        var inserted = jdbc.query("""
            INSERT INTO exchange_issues(id,task_id,operation_id,scope,fingerprint,kind,summary,evidence)
            VALUES (?,?,?,?,?,?,?,?::jsonb) ON CONFLICT(scope,fingerprint) DO NOTHING RETURNING id
            """, (rs,n) -> rs.getObject(1,UUID.class), id, state == null ? null : state.task().id(),
            operationId, scope, fingerprint, kind, reason, json.writeValueAsString(evidence));
        if (inserted.isEmpty()) return jdbc.queryForObject("SELECT id FROM exchange_issues WHERE scope = ? AND fingerprint = ?",
            UUID.class, scope, fingerprint);
        if (state != null) tasks.history(state.task(), null, HistoryType.ISSUE_OPENED, reason, Map.of("issueId", id));
        return id;
    }

    public void temporary(ExchangeState state, boolean delayed) {
        var existing = jdbc.query("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN'
            AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') ORDER BY opened_at LIMIT 1 FOR UPDATE
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().id());
        if (!existing.isEmpty()) {
            if (delayed) jdbc.update("""
                UPDATE exchange_issues SET kind = 'DELIVERY_DELAYED',summary = 'Доставка задерживается после четырёх попыток',
                issue_revision = issue_revision + 1 WHERE id = ? AND kind <> 'DELIVERY_DELAYED'
                """, existing.getFirst());
            return;
        }
        String reason = delayed ? "Доставка задерживается после четырёх попыток" : "Получение операции исполнителем пока не подтверждено";
        open(state, state.task().operationId(), delayed ? "DELIVERY_DELAYED" : "DELIVERY_UNCERTAIN",
            reason, reason, null, null);
    }

    public void confirm(ExchangeState state) {
        var ids = jdbc.query("""
            UPDATE exchange_issues SET status = 'RESOLVED',issue_revision = issue_revision + 1
            WHERE task_id = ? AND status = 'OPEN' AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') RETURNING id
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().id());
        for (UUID id : ids) tasks.history(state.task(), null, HistoryType.ISSUE_RESOLVED,
            "Получение подтверждено; проблема доставки закрыта", Map.of("issueId", id));
    }

    public UUID protocol(ExchangeState state, String reason, Object content) {
        var temporary = jdbc.query("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN'
            AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') ORDER BY opened_at LIMIT 1 FOR UPDATE
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().id());
        if (temporary.isEmpty()) return open(state, state.task().operationId(), "PROTOCOL_ERROR", reason, content, null, null);
        UUID id = temporary.getFirst();
        jdbc.update("UPDATE exchange_issues SET kind = 'PROTOCOL_ERROR',summary = ?,evidence = ?::jsonb,issue_revision = issue_revision + 1 WHERE id = ?",
            reason, json.writeValueAsString(Map.of("reason",reason,"local",snapshot(state))), id);
        tasks.history(state.task(), null, HistoryType.ISSUE_OPENED, reason, Map.of("issueId",id));
        return id;
    }

    public void observe(ExchangeState state, OperationResult result) {
        UUID issue = jdbc.queryForObject("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN' AND kind = 'PROTOCOL_ERROR'
            ORDER BY opened_at DESC LIMIT 1
            """, UUID.class, state.task().id());
        jdbc.update("""
            INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary,details,observed_result,observation_fingerprint)
            VALUES (?,?,?,'SYSTEM','RESULT_IGNORED','Внешний снимок сохранён как наблюдение до решения оператора',?::jsonb,?::jsonb,?)
            ON CONFLICT(operation_id,observation_fingerprint) WHERE observation_fingerprint IS NOT NULL DO NOTHING
            """, UUID.randomUUID(), state.task().id(), result.operationId(),
            json.writeValueAsString(Map.of("issueId",issue,"resultVersion",result.version())),
            json.writeValueAsString(result), ContentFingerprint.of(json,result));
    }

    public Map<String,Object> snapshot(ExchangeState state) {
        var snapshot = new LinkedHashMap<String,Object>();
        snapshot.put("request", state.task().request());
        snapshot.put("deliveryStatus", state.task().deliveryStatus());
        snapshot.put("businessStatus", state.task().businessStatus());
        if (state.result() != null) snapshot.put("resultVersion", state.result().version());
        if (state.task().outcome() != null) {
            var outcome = state.task().outcome();
            var result = new LinkedHashMap<String,Object>();
            result.put("status",outcome.status());
            result.put("completedAt",outcome.completedAt());
            if (outcome.rejectionCode() != null) result.put("rejectionCode",outcome.rejectionCode());
            snapshot.put("result",result);
        }
        return snapshot;
    }

    public record StoredIssue(Issue value, boolean queueFree) {}
    public record SavedReconciliation(Reconciliation value, long exchangeVersion) {}

    private static final String ISSUE_SELECT = """
        SELECT i.*,CASE WHEN t.delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN') THEN q.due_at ELSE NULL END AS next_at,
        (q.operation_id IS NOT NULL AND q.claim_id IS NULL) AS queue_free
        FROM exchange_issues i LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN delivery_queue q ON q.operation_id = i.operation_id
        """;

    private StoredIssue mapIssue(java.sql.ResultSet rs,int n) throws java.sql.SQLException {
        var issue = new Issue(rs.getObject("id",UUID.class),rs.getLong("issue_revision"),
            Issue.KindEnum.fromValue(rs.getString("kind")),IssueStatus.fromValue(rs.getString("status")),
            rs.getObject("opened_at",OffsetDateTime.class),rs.getString("summary"),List.of())
            .taskId(rs.getObject("task_id",UUID.class)).operationId(rs.getObject("operation_id",UUID.class))
            .assignedTo(rs.getObject("assigned_to",UUID.class)).nextAttemptAt(rs.getObject("next_at",OffsetDateTime.class))
            .latestReconciliationId(rs.getObject("latest_reconciliation_id",UUID.class))
            .evidence(json.readValue(rs.getString("evidence"),ExchangeEvidence.class));
        if (rs.getString("resolution") != null) issue.resolution(json.readValue(rs.getString("resolution"),IssueResolution.class));
        return new StoredIssue(issue,rs.getBoolean("queue_free"));
    }

    public StoredIssue get(UUID id,boolean lock) {
        return jdbc.query(ISSUE_SELECT + " WHERE i.id = ?" + (lock ? " FOR UPDATE OF i" : ""),this::mapIssue,id)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public long count(IssueStatus status) {
        return status == null
            ? jdbc.queryForObject("SELECT count(*) FROM exchange_issues", Long.class)
            : jdbc.queryForObject("SELECT count(*) FROM exchange_issues WHERE status = ?", Long.class, status.getValue());
    }

    public List<StoredIssue> list(int page,IssueStatus status) {
        return jdbc.query(ISSUE_SELECT + (status == null ? "" : " WHERE i.status = ?") + " ORDER BY i.opened_at DESC,i.id DESC LIMIT 20 OFFSET ?",
            this::mapIssue,status == null ? new Object[]{(long)page*20} : new Object[]{status.getValue(),(long)page*20});
    }

    public void assign(UUID id,UUID operator) {
        jdbc.update("UPDATE exchange_issues SET assigned_to = ?,issue_revision = issue_revision + 1 WHERE id = ?",operator,id);
    }

    public UUID active(UUID task) {
        return jdbc.query("SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN' ORDER BY (kind = 'PROTOCOL_ERROR') DESC,opened_at DESC,id DESC LIMIT 1",
            (rs,n) -> rs.getObject(1,UUID.class),task).stream().findFirst().orElse(null);
    }

    public void saveReconciliation(Reconciliation value,long version) {
        jdbc.update("INSERT INTO reconciliations(id,task_id,exchange_version,checked_at,checked_by,snapshot) VALUES (?,?,?,?,?,?::jsonb)",
            value.getReconciliationId(),value.getTaskId(),version,value.getCheckedAt(),value.getCheckedBy(),json.writeValueAsString(value));
        jdbc.update("UPDATE exchange_issues SET latest_reconciliation_id = ?,issue_revision = issue_revision + 1 WHERE task_id = ? AND status = 'OPEN'",
            value.getReconciliationId(),value.getTaskId());
    }

    public SavedReconciliation reconciliation(UUID task,UUID id) {
        return jdbc.query("SELECT snapshot::text,exchange_version FROM reconciliations WHERE id = ? AND task_id = ?",
            this::mapReconciliation,id,task)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    private SavedReconciliation mapReconciliation(java.sql.ResultSet rs,int n) throws java.sql.SQLException {
        return new SavedReconciliation(json.readValue(rs.getString(1),Reconciliation.class),rs.getLong(2));
    }

    public Map<UUID,SavedReconciliation> reconciliations(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        var placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT snapshot::text,exchange_version FROM reconciliations WHERE id IN (" + placeholders + ")",
            this::mapReconciliation,ids.toArray()).stream()
            .collect(java.util.stream.Collectors.toMap(row -> row.value().getReconciliationId(),row -> row));
    }

    public void resumeProtocol(UUID id) {
        jdbc.update("UPDATE exchange_issues SET kind = 'DELIVERY_UNCERTAIN',issue_revision = issue_revision + 1 WHERE id = ?",id);
    }

    public void advanceRevision(UUID id) {
        jdbc.update("UPDATE exchange_issues SET issue_revision = issue_revision + 1 WHERE id = ?",id);
    }

    public void resolve(UUID id,IssueResolution resolution) {
        jdbc.update("UPDATE exchange_issues SET status = 'RESOLVED',resolution = ?::jsonb,issue_revision = issue_revision + 1 WHERE id = ?",
            json.writeValueAsString(resolution),id);
    }
}
