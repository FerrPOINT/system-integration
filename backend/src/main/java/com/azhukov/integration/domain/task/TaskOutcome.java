package com.azhukov.integration.domain.task;

import java.time.OffsetDateTime;
import java.util.Objects;

public record TaskOutcome(BusinessStatus status, OffsetDateTime completedAt, String rejectionCode) {
    public TaskOutcome {
        Objects.requireNonNull(status);
        Objects.requireNonNull(completedAt);
        if (!status.isTerminal()) throw new IllegalArgumentException("Итог задания должен быть завершённым");
    }
}
