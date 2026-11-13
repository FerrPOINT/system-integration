package com.azhukov.integration.domain.task;

import java.time.OffsetDateTime;

public record TaskOutcome(BusinessStatus status, OffsetDateTime completedAt, String rejectionCode) {}
