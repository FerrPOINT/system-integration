package com.azhukov.integration.application.port;

import com.azhukov.integration.application.Actor;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.DeliveryStatus;
import java.util.Map;
import com.azhukov.integration.application.task.CreateTask;
import com.azhukov.integration.application.task.HistoryEntry;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface TaskStore {
    Task get(UUID id, Actor user, boolean lock);
    List<Task> list(Actor user, int page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    long countTasks(Actor user, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    Task insert(UUID owner, CreateTask input);
    void enqueue(UUID operationId);
    void rename(UUID id, String title, long revision);
    void history(Task task, UUID actorId, HistoryType type, String summary);
    List<HistoryEntry> history(UUID id, int page);
    long countHistory(UUID id);

    void history(Task task, UUID actorId, HistoryType type, String summary, Object details);
    ExchangeState exchange(UUID operationId, boolean lock);
    Map<UUID,ExchangeState> exchangeByTask(List<UUID> ids);
    UUID lockDueOperation();
    Queue lockQueue(UUID id);
    void startAttempt(UUID operation, UUID claim, String step, int number);
    void finishAttempt(UUID id, String outcome);
    boolean ownsClaim(UUID operation, UUID claim);
    void scheduleAfterInterruptedClaim(UUID operation, OffsetDateTime expiredAt, int seconds);
    void scheduleRetry(UUID operation, String step, int seconds);
    void pauseQueue(UUID operation);
    void removeQueue(UUID operation);
    void delivery(UUID operation, DeliveryStatus status);
    void applyResult(OperationResult result);
    long cursor(boolean lock);
    void advanceCursor(long cursor);

    record Queue(String step, int attempts, UUID claim, OffsetDateTime until) {}
}
