package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.domain.task.TaskOutcome;
import java.util.Objects;

public record ExchangeState(Task task, long version, OperationResult result) {
    private static final long MAX_VERSION = 9007199254740991L;

    public enum IncomingDecision {
        REQUEST_MISMATCH,
        DUPLICATE,
        OLDER,
        OBSERVE,
        STOPPED,
        CONFLICT,
        APPLY
    }

    public ExchangeState {
        Objects.requireNonNull(task);
        if (version < 1 || version > MAX_VERSION) throw new IllegalArgumentException("Некорректная версия обмена");
    }

    public OperationIdentity identity() {
        return new OperationIdentity(task.operationId(), task.request());
    }

    public IncomingDecision disposition(OperationResult received) {
        if (!identity().equals(received.identity())) return IncomingDecision.REQUEST_MISMATCH;
        if (result != null) {
            if (result.version() == received.version() && result.equals(received)) return IncomingDecision.DUPLICATE;
            if (result.version() > received.version()) return IncomingDecision.OLDER;
        }
        if (task.deliveryStatus() == DeliveryStatus.NEEDS_REVIEW) return IncomingDecision.OBSERVE;
        if (task.deliveryStatus() == DeliveryStatus.STOPPED) return IncomingDecision.STOPPED;
        if (result != null && result.version() == received.version()) return IncomingDecision.CONFLICT;
        return IncomingDecision.APPLY;
    }

    public ExchangeState withAppliedResult(OperationResult received) {
        if (!identity().equals(received.identity()))
            throw new IllegalArgumentException("Result identity differs from the task");
        var outcome =
                received.status().isTerminal()
                        ? new TaskOutcome(received.status(), received.completedAt(), received.rejectionCode())
                        : null;
        var updated =
                new Task(
                        task.id(),
                        task.operationId(),
                        task.ownerId(),
                        task.title(),
                        task.request(),
                        DeliveryStatus.ACKNOWLEDGED,
                        received.status(),
                        task.createdAt(),
                        outcome);
        return new ExchangeState(updated, Math.addExact(version, 1), received);
    }

    public ExchangeState withDeliveryStatus(DeliveryStatus status) {
        if (task.deliveryStatus() == status) return this;
        return new ExchangeState(task.withDeliveryStatus(status), Math.addExact(version, 1), result);
    }
}
