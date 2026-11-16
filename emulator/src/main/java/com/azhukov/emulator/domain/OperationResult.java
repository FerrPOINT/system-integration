package com.azhukov.emulator.domain;

import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

public record OperationResult(
        UUID operationId,
        OperationRequest request,
        int version,
        Status status,
        OffsetDateTime completedAt,
        String rejectionCode) {
    public enum Status {
        RUNNING,
        SUCCEEDED,
        REJECTED
    }

    public OperationResult {
        Objects.requireNonNull(operationId);
        Objects.requireNonNull(request);
        Objects.requireNonNull(status);
        boolean running = version == 1 && status == Status.RUNNING && completedAt == null && rejectionCode == null;
        boolean succeeded = version == 2 && status == Status.SUCCEEDED && completedAt != null && rejectionCode == null;
        boolean rejected =
                version == 2
                        && status == Status.REJECTED
                        && completedAt != null
                        && "QUANTITY_LIMIT_EXCEEDED".equals(rejectionCode);
        if (!running && !succeeded && !rejected) throw new IllegalArgumentException("Некорректный результат операции");
    }
}
