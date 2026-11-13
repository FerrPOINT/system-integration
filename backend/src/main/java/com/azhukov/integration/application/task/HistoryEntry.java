package com.azhukov.integration.application.task;

import com.azhukov.integration.domain.task.HistoryType;
import java.time.OffsetDateTime;
import java.util.UUID;

public record HistoryEntry(UUID eventId, UUID taskId, UUID operationId, OffsetDateTime occurredAt,
                           Actor actor, UUID actorUserId, HistoryType type, String summary,
                           UUID attemptId, Integer resultVersion, UUID issueId, UUID reconciliationId,
                           UUID previousAssigneeId, UUID assignedTo) {
    public enum Actor { USER, SYSTEM }
}
