package com.azhukov.integration.repository.springdata;

import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.dto.task.HistoryEntry;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Column;
import org.springframework.data.relational.core.mapping.Table;
import tools.jackson.databind.ObjectMapper;

/** Append-only history is loaded as an independent bounded page, never as Task children. */
@Table("task_history")
record HistoryReadRow(
        @Id UUID id,
        @Column("task_id") UUID taskId,
        @Column("operation_id") UUID operationId,
        @Column("occurred_at") OffsetDateTime occurredAt,
        HistoryEntry.Actor actor,
        @Column("actor_user_id") UUID actorUserId,
        @Column("actor_username") String actorUsername,
        @Column("event_type") HistoryType eventType,
        String summary,
        String details) {
    HistoryEntry entry(ObjectMapper json) {
        var refs = json.readValue(details, Details.class);
        return new HistoryEntry(
                id,
                taskId,
                operationId,
                occurredAt,
                actor,
                actorUserId,
                eventType,
                summary,
                refs.attemptId(),
                refs.resultVersion(),
                refs.issueId(),
                refs.reconciliationId(),
                refs.previousAssigneeId(),
                refs.assignedTo(),
                actorUsername);
    }

    private record Details(
            UUID attemptId,
            Integer resultVersion,
            UUID issueId,
            UUID reconciliationId,
            UUID previousAssigneeId,
            UUID assignedTo) {}
}
