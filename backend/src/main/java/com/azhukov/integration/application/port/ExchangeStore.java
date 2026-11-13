package com.azhukov.integration.application.port;

import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.DeliveryStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface ExchangeStore {
    void enqueue(UUID operationId);
    ExchangeState exchange(UUID operationId, boolean lock);
    Map<UUID,ExchangeState> exchangeByTask(List<UUID> ids);
    Map<UUID,ExchangeState> lockExchanges(List<UUID> operationIds);
    ExchangeState lockDueExchange();
    Queue lockQueue(UUID id);
    void startAttempt(UUID operation, UUID claim, String step, int number);
    void finishAttempt(UUID id, String outcome);
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
