package com.azhukov.integration.infrastructure.jdbc;

import com.azhukov.integration.application.port.ReviewStore;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.*;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.infrastructure.json.ContentFingerprint;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import java.util.List;
import java.time.OffsetDateTime;

@Repository
public class ReviewRepository implements ReviewStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public ReviewRepository(JdbcTemplate jdbc,ObjectMapper json) { this.jdbc=jdbc; this.json=json; }

    public Opened open(UUID task,UUID operation,Issue.Kind kind,String reason,Object content,Evidence evidence) {
        var scope=operation==null ? "feed" : operation.toString();
        var fingerprint=ContentFingerprint.of(json,java.util.Arrays.asList(reason,content));
        UUID id=UUID.randomUUID();
        var inserted=jdbc.query("""
            INSERT INTO exchange_issues(id,task_id,operation_id,scope,fingerprint,kind,summary,evidence)
            VALUES (?,?,?,?,?,?,?,?::jsonb) ON CONFLICT(scope,fingerprint) DO NOTHING RETURNING id
            """,(rs,n) -> rs.getObject(1,UUID.class),id,task,operation,scope,fingerprint,kind.name(),reason,json.writeValueAsString(evidence));
        if (!inserted.isEmpty()) return new Opened(id,true);
        return new Opened(jdbc.queryForObject("SELECT id FROM exchange_issues WHERE scope = ? AND fingerprint = ?",
            UUID.class,scope,fingerprint),false);
    }

    public UUID temporary(UUID task) {
        return jdbc.query("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN'
            AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') ORDER BY opened_at LIMIT 1 FOR UPDATE
            """,(rs,n) -> rs.getObject(1,UUID.class),task).stream().findFirst().orElse(null);
    }

    public void delay(UUID id,String reason) {
        jdbc.update("""
            UPDATE exchange_issues SET kind = 'DELIVERY_DELAYED',summary = ?,
            issue_revision = issue_revision + 1 WHERE id = ? AND (kind <> 'DELIVERY_DELAYED' OR summary IS DISTINCT FROM ?)
            """,reason,id,reason);
    }

    public List<UUID> confirm(UUID task) {
        return jdbc.query("""
            UPDATE exchange_issues SET status = 'RESOLVED',issue_revision = issue_revision + 1
            WHERE task_id = ? AND status = 'OPEN' AND kind IN ('DELIVERY_UNCERTAIN','DELIVERY_DELAYED') RETURNING id
            """,(rs,n) -> rs.getObject(1,UUID.class),task);
    }

    public void protocol(UUID id,String reason,Evidence evidence) {
        jdbc.update("UPDATE exchange_issues SET kind = 'PROTOCOL_ERROR',summary = ?,evidence = ?::jsonb,issue_revision = issue_revision + 1 WHERE id = ?",
            reason,json.writeValueAsString(evidence),id);
    }

    public void observe(ExchangeState state,OperationResult result) {
        UUID issue=jdbc.queryForObject("""
            SELECT id FROM exchange_issues WHERE task_id = ? AND status = 'OPEN' AND kind IN ('PROTOCOL_ERROR','DELIVERY_DELAYED')
            ORDER BY opened_at DESC LIMIT 1
            """,UUID.class,state.task().id());
        jdbc.update("""
            INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary,details,observed_result,observation_fingerprint)
            VALUES (?,?,?,'SYSTEM','RESULT_IGNORED','Внешний снимок сохранён как наблюдение до решения оператора',?::jsonb,?::jsonb,?)
            ON CONFLICT(operation_id,observation_fingerprint) WHERE observation_fingerprint IS NOT NULL DO NOTHING
            """,UUID.randomUUID(),state.task().id(),result.operationId(),
            json.writeValueAsString(Map.of("issueId",issue,"resultVersion",result.version())),
            json.writeValueAsString(result),ContentFingerprint.of(json,result));
    }

    private static final String ISSUE_SELECT = """
        SELECT i.*,CASE WHEN t.delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN') THEN q.due_at ELSE NULL END AS next_at,
        (q.operation_id IS NOT NULL AND q.claim_id IS NULL) AS queue_free
        FROM exchange_issues i LEFT JOIN tasks t ON t.id = i.task_id LEFT JOIN delivery_queue q ON q.operation_id = i.operation_id
        """;

    private StoredIssue mapIssue(java.sql.ResultSet rs,int n) throws java.sql.SQLException {
        var issue = new Issue(rs.getObject("id",UUID.class),rs.getObject("task_id",UUID.class),
            rs.getObject("operation_id",UUID.class),rs.getLong("issue_revision"),
            Issue.Kind.valueOf(rs.getString("kind")),Issue.Status.valueOf(rs.getString("status")),
            rs.getObject("opened_at",OffsetDateTime.class),rs.getString("summary"),rs.getObject("assigned_to",UUID.class),
            json.readValue(rs.getString("evidence"),Evidence.class),List.of(),rs.getObject("next_at",OffsetDateTime.class),
            rs.getObject("latest_reconciliation_id",UUID.class),
            rs.getString("resolution")==null ? null : json.readValue(rs.getString("resolution"),IssueResolution.class));
        return new StoredIssue(issue,rs.getBoolean("queue_free"));
    }

    public StoredIssue get(UUID id,boolean lock) {
        return jdbc.query(ISSUE_SELECT + " WHERE i.id = ?" + (lock ? " FOR UPDATE OF i" : ""),this::mapIssue,id)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public long count(Issue.Status status) {
        return status == null
            ? jdbc.queryForObject("SELECT count(*) FROM exchange_issues", Long.class)
            : jdbc.queryForObject("SELECT count(*) FROM exchange_issues WHERE status = ?", Long.class, status.name());
    }

    public List<StoredIssue> list(int page,int size,Issue.Status status) {
        return jdbc.query(ISSUE_SELECT + (status == null ? "" : " WHERE i.status = ?") + " ORDER BY i.opened_at DESC,i.id DESC LIMIT ? OFFSET ?",
            this::mapIssue,status == null ? new Object[]{size,(long)page*size} : new Object[]{status.name(),size,(long)page*size});
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
            value.reconciliationId(),value.taskId(),version,value.checkedAt(),value.checkedBy(),json.writeValueAsString(value));
        jdbc.update("UPDATE exchange_issues SET latest_reconciliation_id = ?,issue_revision = issue_revision + 1 WHERE task_id = ? AND status = 'OPEN'",
            value.reconciliationId(),value.taskId());
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
            .collect(java.util.stream.Collectors.toMap(row -> row.value().reconciliationId(),row -> row));
    }

    public void resumeDelivery(UUID id,String summary) {
        jdbc.update("UPDATE exchange_issues SET kind = 'DELIVERY_UNCERTAIN',summary = ?,issue_revision = issue_revision + 1 WHERE id = ?",summary,id);
    }

    public void resolve(UUID id,IssueResolution resolution) {
        jdbc.update("UPDATE exchange_issues SET status = 'RESOLVED',resolution = ?::jsonb,issue_revision = issue_revision + 1 WHERE id = ?",
            json.writeValueAsString(resolution),id);
    }
}
