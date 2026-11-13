package com.azhukov.integration.infrastructure.jdbc;

import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.application.Actor;
import com.azhukov.integration.application.port.TaskStore;
import com.azhukov.integration.application.task.CreateTask;
import com.azhukov.integration.application.task.HistoryEntry;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.domain.task.TaskTitle;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskOutcome;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.RuleViolation;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class TaskRepository implements TaskStore {
    private static final Logger log = LoggerFactory.getLogger(TaskRepository.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public TaskRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    private final RowMapper<Task> taskRow = this::mapTask;

    private Task mapTask(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        var business = BusinessStatus.valueOf(rs.getString("business_status"));
        var stored = rs.getString("accepted_result");
        TaskOutcome outcome = null;
        if (stored != null && business.isTerminal()) {
            var result = json.readTree(stored);
            outcome = new TaskOutcome(BusinessStatus.valueOf(result.get("status").asString()),
                OffsetDateTime.parse(result.get("completedAt").asString()),
                result.has("rejectionCode") ? result.get("rejectionCode").asString() : null);
        }
        return mapTask(rs,business,outcome);
    }

    private OperationResult storedResult(java.sql.ResultSet rs) throws java.sql.SQLException {
        var value = rs.getString("accepted_result");
        return value == null ? null : json.readValue(value,OperationResult.class);
    }

    private Task mapTask(java.sql.ResultSet rs, BusinessStatus business, TaskOutcome outcome) throws java.sql.SQLException {
        return new Task(rs.getObject("id",UUID.class),rs.getObject("operation_id",UUID.class),
            rs.getObject("owner_id",UUID.class),new TaskTitle(rs.getString("title"),rs.getLong("title_revision")),
            new TaskInput(rs.getString("request_reference"),rs.getInt("request_quantity")),
            DeliveryStatus.valueOf(rs.getString("delivery_status")),business,
            rs.getObject("created_at",OffsetDateTime.class),outcome);
    }

    public Task get(UUID id, Actor user, boolean lock) {
        var rows = jdbc.query("SELECT * FROM tasks WHERE id = ?" +
            (user.isOperator() ? "" : " AND owner_id = ?") + (lock ? " FOR UPDATE" : ""),
            taskRow, user.isOperator() ? new Object[]{id} : new Object[]{id, user.id()});
        return rows.stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public ExchangeState exchange(UUID operationId, boolean lock) {
        return jdbc.query("SELECT * FROM tasks WHERE operation_id = ?" + (lock ? " FOR UPDATE" : ""),
            this::mapExchange, operationId)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    private ExchangeState mapExchange(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        var business = BusinessStatus.valueOf(rs.getString("business_status"));
        var result = storedResult(rs);
        var outcome = result != null && business.isTerminal()
            ? new TaskOutcome(result.status(),result.completedAt(),result.rejectionCode())
            : null;
        return new ExchangeState(mapTask(rs,business,outcome),rs.getLong("exchange_version"),result);
    }

    public Map<UUID,ExchangeState> exchangeByTask(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        var placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT * FROM tasks WHERE id IN (" + placeholders + ")", this::mapExchange, ids.toArray())
            .stream().collect(java.util.stream.Collectors.toMap(row -> row.task().id(), row -> row));
    }

    public List<Task> list(Actor user, int page, BusinessStatus status,
                           OffsetDateTime from, OffsetDateTime to) {
        var args = new ArrayList<Object>();
        var sql = "SELECT * FROM tasks" + taskConditions(user, status, from, to, args)
            + " ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?";
        args.add((long) page * 20);
        return jdbc.query(sql, taskRow, args.toArray());
    }

    public long countTasks(Actor user, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        var args = new ArrayList<Object>();
        return jdbc.queryForObject("SELECT count(*) FROM tasks" + taskConditions(user, status, from, to, args),
            Long.class, args.toArray());
    }

    private static String taskConditions(Actor user, BusinessStatus status,
                                         OffsetDateTime from, OffsetDateTime to, List<Object> args) {
        var where = new StringBuilder(" WHERE true");
        if (!user.isOperator()) { where.append(" AND owner_id = ?"); args.add(user.id()); }
        if (status != null) { where.append(" AND business_status = ?"); args.add(status.name()); }
        if (from != null) { where.append(" AND created_at >= ?"); args.add(from); }
        if (to != null) { where.append(" AND created_at < ?"); args.add(to); }
        return where.toString();
    }

    public Task insert(UUID owner, CreateTask input) {
        UUID id = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        return jdbc.query("""
            INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity)
            VALUES (?,?,?,?,?,?) RETURNING *
            """, taskRow, id, owner, operationId, input.title(),
            input.request().reference(), input.request().quantity()).getFirst();
    }

    public void enqueue(UUID operationId) {
        jdbc.update("INSERT INTO delivery_queue(operation_id) VALUES (?)", operationId);
    }

    public void rename(UUID id, String title, long revision) {
        jdbc.update("UPDATE tasks SET title = ?, title_revision = ? WHERE id = ?", title, revision, id);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void history(Task task, UUID actorId, HistoryType type, String summary) {
        history(task, actorId, type, summary, java.util.Map.of());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void history(Task task, UUID actorId, HistoryType type, String summary, Object details) {
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO task_history(id,task_id,operation_id,actor,actor_user_id,event_type,summary,details)
            VALUES (?,?,?,?,?,?,?,?::jsonb)
            """, eventId, task.id(), task.operationId(),
            actorId == null ? "SYSTEM" : "USER", actorId, type.name(), summary, json.writeValueAsString(details));
        var references = json.valueToTree(details);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                log.info("audit eventId={} taskId={} operationId={} type={} actorUserId={} attemptId={} resultVersion={} issueId={} reconciliationId={}",
                    eventId,task.id(),task.operationId(),type.name(),actorId,
                    references.get("attemptId"),references.get("resultVersion"),
                    references.get("issueId"),references.get("reconciliationId"));
            }
        });
    }

    public long countHistory(UUID id) {
        return jdbc.queryForObject("SELECT count(*) FROM task_history WHERE task_id = ?", Long.class, id);
    }

    public List<HistoryEntry> history(UUID id, int page) {
        return jdbc.query("""
            SELECT * FROM task_history WHERE task_id = ?
            ORDER BY occurred_at DESC, id DESC LIMIT 20 OFFSET ?
            """, (rs, row) -> {
                var details = json.readValue(rs.getString("details"),HistoryDetails.class);
                return new HistoryEntry(rs.getObject("id",UUID.class),id,rs.getObject("operation_id",UUID.class),
                    rs.getObject("occurred_at",OffsetDateTime.class),HistoryEntry.Actor.valueOf(rs.getString("actor")),
                    rs.getObject("actor_user_id",UUID.class),HistoryType.valueOf(rs.getString("event_type")),rs.getString("summary"),
                    details.attemptId(),details.resultVersion(),details.issueId(),details.reconciliationId(),
                    details.previousAssigneeId(),details.assignedTo());
            }, id, (long) page * 20);
    }

    private record HistoryDetails(UUID attemptId,Integer resultVersion,UUID issueId,UUID reconciliationId,
                                  UUID previousAssigneeId,UUID assignedTo) {}

    public UUID lockDueOperation() {
        return jdbc.query("""
            SELECT t.operation_id FROM tasks t JOIN delivery_queue q ON q.operation_id = t.operation_id
            WHERE t.delivery_status IN ('QUEUED','RETRY_WAIT','UNKNOWN') AND q.due_at <= statement_timestamp()
              AND (q.claim_id IS NULL OR q.claimed_until <= statement_timestamp())
            ORDER BY q.due_at,q.operation_id LIMIT 1 FOR UPDATE OF t SKIP LOCKED
            """,(rs,n) -> rs.getObject(1,UUID.class)).stream().findFirst().orElse(null);
    }

    public Queue lockQueue(UUID id) {
        return jdbc.queryForObject("SELECT * FROM delivery_queue WHERE operation_id = ? FOR UPDATE",(rs,n) ->
            new Queue(rs.getString("next_step"),rs.getInt("attempts"),rs.getObject("claim_id",UUID.class),
                rs.getObject("claimed_until",OffsetDateTime.class)),id);
    }

    public void startAttempt(UUID operation, UUID claim, String step, int number) {
        jdbc.update("UPDATE delivery_queue SET claim_id = ?,claimed_until = clock_timestamp() + interval '15 seconds',attempts = ? WHERE operation_id = ?",claim,number,operation);
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

    public long cursor(boolean lock) {
        return jdbc.queryForObject("SELECT last_cursor FROM incoming_position WHERE id = 1" + (lock ? " FOR UPDATE" : ""),Long.class);
    }

    public void advanceCursor(long cursor) { jdbc.update("UPDATE incoming_position SET last_cursor = ? WHERE id = 1",cursor); }
}
