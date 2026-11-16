package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.TaskInput;
import java.util.Objects;
import java.util.UUID;

public record OperationIdentity(UUID id, TaskInput request) {
    public OperationIdentity {
        Objects.requireNonNull(id);
        Objects.requireNonNull(request);
    }

    public void requireSame(OperationIdentity other) {
        if (!equals(other)) throw new IllegalArgumentException("ID или неизменный запрос не совпадает с заданием");
    }
}
