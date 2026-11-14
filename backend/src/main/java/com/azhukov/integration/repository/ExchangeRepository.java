package com.azhukov.integration.repository;

import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.DeliveryStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * PostgreSQL outbox/result storage in short service transactions. Explicit SQL
 * preserves SKIP LOCKED, lease ownership and ordered batch locks. Result changes
 * and the feed cursor commit together; external HTTP never runs under these locks.
 */
public interface ExchangeRepository {
    void enqueue(UUID operationId);
    ExchangeState exchange(UUID operationId, boolean lock);
    Map<UUID,ExchangeState> exchangeByTask(List<UUID> ids);
    /** Locks the bounded input batch in task-id order, shared with command lock ordering. */
    Map<UUID,ExchangeState> lockExchanges(List<UUID> operationIds);
    /** Locks one eligible due task with SKIP LOCKED; returns null when no task can be claimed. */
    ExchangeState lockDueExchange();
    Queue lockQueue(UUID id);
    void startAttempt(UUID operation, UUID claim, String step, int number);
    void finishAttempt(UUID id, String outcome);
    /** True only for the current unexpired lease; late HTTP completions cannot finish a new claim. */
    boolean ownsClaim(UUID operation, UUID claim);
    void scheduleAfterInterruptedClaim(UUID operation, OffsetDateTime expiredAt, int seconds);
    void scheduleRetry(UUID operation, String step, int seconds);
    void resumeDelivery(UUID operation);
    void pauseQueue(UUID operation);
    void removeQueue(UUID operation);
    void delivery(UUID operation, DeliveryStatus status);
    void applyResult(OperationResult result);
    long cursor(boolean lock);
    void advanceCursor(long cursor);

    record Queue(String step, int attempts, int automaticAttempts, UUID claim, OffsetDateTime until) {
        public Queue {
            if (attempts < 0 || automaticAttempts < 0 || automaticAttempts > attempts)
                throw new IllegalArgumentException("Некорректный счётчик попыток доставки");
        }
    }
}
