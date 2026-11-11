package com.azhukov.integration.tasks;

import com.azhukov.integration.contract.external.model.Result;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.http.ApiProblem;
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
    private final TaskRepository tasks;

    public ExchangeIssues(JdbcTemplate jdbc, ObjectMapper json, TaskRepository tasks) {
        this.jdbc = jdbc; this.json = json; this.tasks = tasks;
    }

    public UUID open(TaskRepository.ExchangeTask state, UUID operationId, String kind, String reason,
                     Object content, Result received, Long cursor) {
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
            """, (rs,n) -> rs.getObject(1,UUID.class), id, state == null ? null : state.task().getTaskId(),
            operationId, scope, fingerprint, kind, reason, json.writeValueAsString(evidence));
        if (inserted.isEmpty()) return jdbc.queryForObject("SELECT id FROM exchange_issues WHERE scope = ? AND fingerprint = ?",
            UUID.class, scope, fingerprint);
        if (state != null) tasks.history(state.task(), null, HistoryEvent.TypeEnum.ISSUE_OPENED, reason, Map.of("issueId", id));
        return id;
    }

    public void temporary(TaskRepository.ExchangeTask state, boolean delayed) {
        var existing = jdbc.query("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN'
            AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') ORDER BY opened_at LIMIT 1 FOR UPDATE
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().getTaskId());
        if (!existing.isEmpty()) {
            if (delayed) jdbc.update("""
                UPDATE exchange_issues SET kind = 'DELIVERY_DELAYED',summary = 'Доставка задерживается после четырёх попыток',
                issue_revision = issue_revision + 1 WHERE id = ? AND kind <> 'DELIVERY_DELAYED'
                """, existing.getFirst());
            return;
        }
        String reason = delayed ? "Доставка задерживается после четырёх попыток" : "Получение операции исполнителем пока не подтверждено";
        open(state, state.task().getOperationId(), delayed ? "DELIVERY_DELAYED" : "DELIVERY_UNCERTAIN",
            reason, reason, null, null);
    }

    public void confirm(TaskRepository.ExchangeTask state) {
        var ids = jdbc.query("""
            UPDATE exchange_issues SET status = 'RESOLVED',issue_revision = issue_revision + 1
            WHERE task_id = ? AND status = 'OPEN' AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') RETURNING id
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().getTaskId());
        for (UUID id : ids) tasks.history(state.task(), null, HistoryEvent.TypeEnum.ISSUE_RESOLVED,
            "Получение подтверждено; проблема доставки закрыта", Map.of("issueId", id));
    }

    public UUID protocol(TaskRepository.ExchangeTask state, String reason, Object content) {
        var temporary = jdbc.query("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN'
            AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') ORDER BY opened_at LIMIT 1 FOR UPDATE
            """, (rs,n) -> rs.getObject(1,UUID.class), state.task().getTaskId());
        if (temporary.isEmpty()) return open(state, state.task().getOperationId(), "PROTOCOL_ERROR", reason, content, null, null);
        UUID id = temporary.getFirst();
        jdbc.update("UPDATE exchange_issues SET kind = 'PROTOCOL_ERROR',summary = ?,evidence = ?::jsonb,issue_revision = issue_revision + 1 WHERE id = ?",
            reason, json.writeValueAsString(Map.of("reason",reason,"local",snapshot(state))), id);
        tasks.history(state.task(), null, HistoryEvent.TypeEnum.ISSUE_OPENED, reason, Map.of("issueId",id));
        return id;
    }

    public void observe(TaskRepository.ExchangeTask state, Result result) {
        UUID issue = jdbc.queryForObject("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN' AND kind = 'PROTOCOL_ERROR'
            ORDER BY opened_at DESC LIMIT 1
            """, UUID.class, state.task().getTaskId());
        jdbc.update("""
            INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary,details,observed_result,observation_fingerprint)
            VALUES (?,?,?,'SYSTEM','RESULT_IGNORED','Внешний снимок сохранён как наблюдение до решения оператора',?::jsonb,?::jsonb,?)
            ON CONFLICT(operation_id,observation_fingerprint) WHERE observation_fingerprint IS NOT NULL DO NOTHING
            """, UUID.randomUUID(), state.task().getTaskId(), result.getOperationId(),
            json.writeValueAsString(Map.of("issueId",issue,"resultVersion",result.getVersion().getValue())),
            json.writeValueAsString(result), ContentFingerprint.of(json,result));
    }

    public Map<String,Object> snapshot(TaskRepository.ExchangeTask state) {
        var snapshot = new LinkedHashMap<String,Object>();
        snapshot.put("request", state.task().getRequest());
        snapshot.put("deliveryStatus", state.task().getDeliveryStatus());
        snapshot.put("businessStatus", state.task().getBusinessStatus());
        if (state.result() != null) snapshot.put("resultVersion", state.result().getVersion().getValue());
        if (state.task().getResult() != null) snapshot.put("result", state.task().getResult());
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
            .stream().findFirst().orElseThrow(ApiProblem::notFound);
    }

    public List<StoredIssue> list(int page,IssueStatus status) {
        return jdbc.query(ISSUE_SELECT + (status == null ? "" : " WHERE i.status = ?") + " ORDER BY i.opened_at DESC,i.id DESC LIMIT 21 OFFSET ?",
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
            (rs,n) -> new SavedReconciliation(json.readValue(rs.getString(1),Reconciliation.class),rs.getLong(2)),id,task)
            .stream().findFirst().orElseThrow(ApiProblem::notFound);
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
