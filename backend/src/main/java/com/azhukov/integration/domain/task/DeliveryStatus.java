package com.azhukov.integration.domain.task;

public enum DeliveryStatus {
    QUEUED,
    RETRY_WAIT,
    UNKNOWN,
    ACKNOWLEDGED,
    NEEDS_REVIEW,
    STOPPED
}
