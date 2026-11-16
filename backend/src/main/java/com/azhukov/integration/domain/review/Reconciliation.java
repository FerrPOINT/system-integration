package com.azhukov.integration.domain.review;

import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import java.time.OffsetDateTime;
import java.util.UUID;

public record Reconciliation(
        UUID reconciliationId,
        UUID taskId,
        UUID operationId,
        OffsetDateTime checkedAt,
        UUID checkedBy,
        Outcome outcome,
        LocalSnapshot local,
        Availability externalAvailability,
        OperationSnapshot external,
        UUID issueId) {
    public enum Outcome {
        MATCH,
        DIFFERENCE,
        UNAVAILABLE
    }

    public enum Availability {
        PRESENT,
        NOT_FOUND,
        UNAVAILABLE
    }
}
