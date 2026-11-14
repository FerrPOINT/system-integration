package com.azhukov.integration.domain.task;

import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;

/** Immutable task state; title changes cannot rewrite its owner, request or external outcome. */
public record Task(
        UUID id,
        UUID operationId,
        UUID ownerId,
        TaskTitle title,
        TaskInput request,
        DeliveryStatus deliveryStatus,
        BusinessStatus businessStatus,
        OffsetDateTime createdAt,
        TaskOutcome outcome) {
    public Task {
        Objects.requireNonNull(id);
        Objects.requireNonNull(operationId);
        Objects.requireNonNull(ownerId);
        Objects.requireNonNull(title);
        Objects.requireNonNull(request);
        Objects.requireNonNull(deliveryStatus);
        Objects.requireNonNull(businessStatus);
        Objects.requireNonNull(createdAt);
    }

    public Task rename(String value, long expectedRevision) {
        return new Task(
                id,
                operationId,
                ownerId,
                title.rename(value, expectedRevision),
                request,
                deliveryStatus,
                businessStatus,
                createdAt,
                outcome);
    }

    public Task withDeliveryStatus(DeliveryStatus value) {
        return new Task(id, operationId, ownerId, title, request, value, businessStatus, createdAt, outcome);
    }
}
