package com.azhukov.integration.domain.review;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record Issue(UUID issueId, UUID taskId, UUID operationId, long issueRevision, Kind kind, Status status,
                    OffsetDateTime openedAt, String summary, UUID assignedTo, Evidence evidence,
                    List<Action> allowedActions, OffsetDateTime nextAttemptAt,
                    UUID latestReconciliationId, IssueResolution resolution) {
    public enum Kind { DELIVERY_UNCERTAIN, DELIVERY_DELAYED, PROTOCOL_ERROR, RESULT_CONFLICT, RECONCILIATION_DIFFERENCE }
    public enum Status { OPEN, RESOLVED }
    public enum Action { TAKE_OWNERSHIP, RECONCILE, RETRY, APPLY_EXTERNAL_RESULT, ACKNOWLEDGE_DIFFERENCE }

    public Issue { allowedActions=List.copyOf(allowedActions); }

    /** Actions are a derived view, never authority for a subsequent command. */
    public Issue withActions(List<Action> actions) {
        return new Issue(issueId,taskId,operationId,issueRevision,kind,status,openedAt,summary,assignedTo,evidence,
            actions,nextAttemptAt,latestReconciliationId,resolution);
    }
}
