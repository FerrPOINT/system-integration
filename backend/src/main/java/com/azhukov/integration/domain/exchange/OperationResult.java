package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.TaskInput;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

public record OperationResult(
        UUID operationId,
        TaskInput request,
        int version,
        BusinessStatus status,
        OffsetDateTime completedAt,
        String rejectionCode) {
    public OperationResult {
        Objects.requireNonNull(operationId);
        Objects.requireNonNull(request);
        Objects.requireNonNull(status);
        boolean running =
                version == 1 && status == BusinessStatus.RUNNING && completedAt == null && rejectionCode == null;
        boolean terminal =
                version == 2
                        && completedAt != null
                        && ((status == BusinessStatus.SUCCEEDED && rejectionCode == null)
                                || (status == BusinessStatus.REJECTED
                                        && "QUANTITY_LIMIT_EXCEEDED".equals(rejectionCode)));
        if (!running && !terminal) throw new IllegalArgumentException("Некорректный вариант результата операции");
    }

    public OperationIdentity identity() {
        return new OperationIdentity(operationId, request);
    }
}
