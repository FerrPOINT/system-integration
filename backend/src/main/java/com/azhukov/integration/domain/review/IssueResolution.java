package com.azhukov.integration.domain.review;

import java.time.OffsetDateTime;
import java.util.UUID;

public record IssueResolution(UUID issueId, UUID reconciliationId, Action action, String reason,
                              UUID decidedBy, OffsetDateTime decidedAt) {
    public enum Action { APPLY_EXTERNAL_RESULT, ACKNOWLEDGE_DIFFERENCE }
}
