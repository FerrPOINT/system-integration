package com.azhukov.integration.repository.jdbc;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.json.ContentFingerprint;
import com.azhukov.integration.repository.TaskRepository;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

/**
 * Command SQL and the sole append-only history writer. History requires the service
 * transaction; deduplicated observations audit only after a real insert commits.
 * UI reads are owned by SpringDataTaskReadRepository.
 */
@Repository
@RequiredArgsConstructor
@Slf4j
public class JdbcTaskRepository implements TaskRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TaskRowMapper rowMapper;

    public Task get(UUID id, Actor user, boolean lock) {
        var rows =
                jdbc.query(
                        "SELECT * FROM tasks WHERE id = ?"
                                + (user.isOperator() ? "" : " AND owner_id = ?")
                                + (lock ? " FOR UPDATE" : ""),
                        rowMapper,
                        user.isOperator() ? new Object[] {id} : new Object[] {id, user.id()});
        return rows.stream().findFirst().orElseThrow(RuleViolation::notFound);
    }

    public Task insert(UUID owner, CreateTask input) {
        UUID id = UUID.randomUUID();
        UUID operationId = UUID.randomUUID();
        return jdbc.query(
                        """
                        INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity)
                        VALUES (?,?,?,?,?,?) RETURNING *
                        """,
                        rowMapper,
                        id,
                        owner,
                        operationId,
                        input.title(),
                        input.request().reference(),
                        input.request().quantity())
                .getFirst();
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
        jdbc.update(
                """
                INSERT INTO task_history(id,task_id,operation_id,actor,actor_user_id,event_type,summary,details)
                VALUES (?,?,?,?,?,?,?,?::jsonb)
                """,
                eventId,
                task.id(),
                task.operationId(),
                actorId == null ? "SYSTEM" : "USER",
                actorId,
                type.name(),
                summary,
                json.writeValueAsString(details));
        auditAfterCommit(eventId, task, actorId, type, details);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void observe(Task task, UUID issue, OperationResult result, String summary) {
        UUID eventId = UUID.randomUUID();
        var details = Map.of("issueId", issue, "resultVersion", result.version());
        int inserted =
                jdbc.update(
                        """
                        INSERT INTO task_history(id,task_id,operation_id,actor,event_type,summary,details,observed_result,observation_fingerprint)
                        VALUES (?,?,?,'SYSTEM','RESULT_IGNORED',?,?::jsonb,?::jsonb,?)
                        ON CONFLICT(operation_id,observation_fingerprint) WHERE observation_fingerprint IS NOT NULL DO NOTHING
                        """,
                        eventId,
                        task.id(),
                        result.operationId(),
                        summary,
                        json.writeValueAsString(details),
                        json.writeValueAsString(result),
                        ContentFingerprint.of(json, result));
        if (inserted == 1) auditAfterCommit(eventId, task, null, HistoryType.RESULT_IGNORED, details);
    }

    private void auditAfterCommit(UUID eventId, Task task, UUID actorId, HistoryType type, Object details) {
        var references = json.valueToTree(details);
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        log.info(
                                "audit eventId={} taskId={} operationId={} type={} actorUserId={} attemptId={} resultVersion={} issueId={} reconciliationId={}",
                                eventId,
                                task.id(),
                                task.operationId(),
                                type.name(),
                                actorId,
                                references.get("attemptId"),
                                references.get("resultVersion"),
                                references.get("issueId"),
                                references.get("reconciliationId"));
                    }
                });
    }
}
