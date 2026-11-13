package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.TaskInput;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

public record OperationSnapshot(UUID operationId, TaskInput request, OffsetDateTime acceptedAt,
                                int executions, OperationResult result) {
    public OperationSnapshot {
        Objects.requireNonNull(operationId);
        Objects.requireNonNull(request);
        Objects.requireNonNull(acceptedAt);
        if (executions < 0 || executions > 1 || ((executions == 1) != (result != null && result.version() == 2)))
            throw new IllegalArgumentException("Счётчик исполнения не соответствует результату");
        if (result != null) new OperationIdentity(operationId,request).requireSame(result.identity());
    }
    public OperationIdentity identity() { return new OperationIdentity(operationId,request); }
}
