package com.azhukov.integration.tasks;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.contract.internal.model.*;
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
public class TaskRepository {
    private static final Logger log = LoggerFactory.getLogger(TaskRepository.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public TaskRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    private final RowMapper<Task> taskRow = this::mapTask;

    private Task mapTask(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        var task = new Task(
        rs.getObject("id", UUID.class), rs.getObject("operation_id", UUID.class),
        rs.getObject("owner_id", UUID.class), rs.getString("title"), rs.getLong("title_revision"),
        new Request(rs.getString("request_reference"), rs.getInt("request_quantity")),
        DeliveryStatus.fromValue(rs.getString("delivery_status")),
        BusinessStatus.fromValue(rs.getString("business_status")),
        rs.getObject("created_at", OffsetDateTime.class));
        if (rs.getString("accepted_result") != null &&
            (task.getBusinessStatus() == BusinessStatus.SUCCEEDED || task.getBusinessStatus() == BusinessStatus.REJECTED)) {
            var result = json.readTree(rs.getString("accepted_result"));
            task.result(new TaskResult(TaskResult.StatusEnum.fromValue(result.get("status").asString()),
                OffsetDateTime.parse(result.get("completedAt").asString()))
                .rejectionCode(result.has("rejectionCode") ? TaskResult.RejectionCodeEnum.fromValue(result.get("rejectionCode").asString()) : null));
        }
        return task;
    }

    public Task get(UUID id, AppUser user, boolean lock) {
        var rows = jdbc.query("SELECT * FROM tasks WHERE id = ?" +
            (user.isOperator() ? "" : " AND owner_id = ?") + (lock ? " FOR UPDATE" : ""),
            taskRow, user.isOperator() ? new Object[]{id} : new Object[]{id, user.id()});
        return rows.stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public record ExchangeTask(Task task, long version, com.azhukov.integration.contract.external.model.Result result) {}

    public ExchangeTask exchange(UUID operationId, boolean lock) {
        return jdbc.query("SELECT * FROM tasks WHERE operation_id = ?" + (lock ? " FOR UPDATE" : ""),
            this::mapExchange, operationId)
            .stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    private ExchangeTask mapExchange(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new ExchangeTask(taskRow.mapRow(rs,n), rs.getLong("exchange_version"),
            rs.getString("accepted_result") == null ? null : json.readValue(rs.getString("accepted_result"),
                com.azhukov.integration.contract.external.model.Result.class));
    }

    public Map<UUID,ExchangeTask> exchangeByTask(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        var placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT * FROM tasks WHERE id IN (" + placeholders + ")", this::mapExchange, ids.toArray())
            .stream().collect(java.util.stream.Collectors.toMap(row -> row.task().getTaskId(), row -> row));
    }

    public List<Task> list(AppUser user, int page, BusinessStatus status,
                           OffsetDateTime from, OffsetDateTime to) {
        var args = new ArrayList<Object>();
        var sql = "SELECT * FROM tasks" + taskConditions(user, status, from, to, args)
            + " ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?";
        args.add((long) page * 20);
        return jdbc.query(sql, taskRow, args.toArray());
    }

    public long countTasks(AppUser user, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        var args = new ArrayList<Object>();
        return jdbc.queryForObject("SELECT count(*) FROM tasks" + taskConditions(user, status, from, to, args),
            Long.class, args.toArray());
    }

    private static String taskConditions(AppUser user, BusinessStatus status,
                                         OffsetDateTime from, OffsetDateTime to, List<Object> args) {
        var where = new StringBuilder(" WHERE true");
        if (!user.isOperator()) { where.append(" AND owner_id = ?"); args.add(user.id()); }
        if (status != null) { where.append(" AND business_status = ?"); args.add(status.getValue()); }
        if (from != null) { where.append(" AND created_at >= ?"); args.add(from); }
        if (to != null) { where.append(" AND created_at < ?"); args.add(to); }
        return where.toString();
    }

    public Task insert(UUID owner, CreateTaskRequest input) {
        UUID id = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        return jdbc.query("""
            INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity)
            VALUES (?,?,?,?,?,?) RETURNING *
            """, taskRow, id, owner, operationId, input.getTitle(),
            input.getRequest().getReference(), input.getRequest().getQuantity()).getFirst();
    }

    public void enqueue(UUID operationId) {
        jdbc.update("INSERT INTO delivery_queue(operation_id) VALUES (?)", operationId);
    }

    public void rename(UUID id, String title, long revision) {
        jdbc.update("UPDATE tasks SET title = ?, title_revision = ? WHERE id = ?", title, revision, id);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void history(Task task, UUID actorId, HistoryEvent.TypeEnum type, String summary) {
        history(task, actorId, type, summary, java.util.Map.of());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void history(Task task, UUID actorId, HistoryEvent.TypeEnum type, String summary, Object details) {
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO task_history(id,task_id,operation_id,actor,actor_user_id,event_type,summary,details)
            VALUES (?,?,?,?,?,?,?,?::jsonb)
            """, eventId, task.getTaskId(), task.getOperationId(),
            actorId == null ? "SYSTEM" : "USER", actorId, type.getValue(), summary, json.writeValueAsString(details));
        var references = json.valueToTree(details);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                log.info("audit eventId={} taskId={} operationId={} type={} actorUserId={} attemptId={} resultVersion={} issueId={} reconciliationId={}",
                    eventId,task.getTaskId(),task.getOperationId(),type.getValue(),actorId,
                    references.get("attemptId"),references.get("resultVersion"),
                    references.get("issueId"),references.get("reconciliationId"));
            }
        });
    }

    public long countHistory(UUID id) {
        return jdbc.queryForObject("SELECT count(*) FROM task_history WHERE task_id = ?", Long.class, id);
    }

    public List<HistoryEvent> history(UUID id, int page) {
        return jdbc.query("""
            SELECT * FROM task_history WHERE task_id = ?
            ORDER BY occurred_at DESC, id DESC LIMIT 20 OFFSET ?
            """, (rs, row) -> {
                var event = json.readValue(rs.getString("details"), HistoryEvent.class);
                return event.eventId(rs.getObject("id", UUID.class)).taskId(id)
                    .operationId(rs.getObject("operation_id", UUID.class))
                    .occurredAt(rs.getObject("occurred_at", OffsetDateTime.class))
                    .actor(HistoryEvent.ActorEnum.fromValue(rs.getString("actor")))
                    .actorUserId(rs.getObject("actor_user_id", UUID.class))
                    .type(HistoryEvent.TypeEnum.fromValue(rs.getString("event_type")))
                    .summary(rs.getString("summary"));
            }, id, (long) page * 20);
    }

    public record Queue(String step, int attempts, UUID claim, OffsetDateTime until) {}

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
        jdbc.update("UPDATE tasks SET delivery_status = ?,exchange_version = exchange_version + 1 WHERE operation_id = ? AND delivery_status <> ?",status.getValue(),operation,status.getValue());
    }

    public void applyResult(com.azhukov.integration.contract.external.model.Result result) {
        jdbc.update("UPDATE tasks SET accepted_result = ?::jsonb,business_status = ?,delivery_status = 'ACKNOWLEDGED',exchange_version = exchange_version + 1 WHERE operation_id = ?",
            json.writeValueAsString(result),result.getStatus().getValue(),result.getOperationId());
    }

    public long cursor(boolean lock) {
        return jdbc.queryForObject("SELECT last_cursor FROM incoming_position WHERE id = 1" + (lock ? " FOR UPDATE" : ""),Long.class);
    }

    public void advanceCursor(long cursor) { jdbc.update("UPDATE incoming_position SET last_cursor = ? WHERE id = 1",cursor); }
}
