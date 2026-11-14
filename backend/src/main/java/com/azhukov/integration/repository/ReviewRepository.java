package com.azhukov.integration.repository;

import com.azhukov.integration.domain.review.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface ReviewRepository {
    record Opened(UUID id, boolean created) {}
    record StoredIssue(Issue value, boolean queueFree) {}
    record SavedReconciliation(Reconciliation value, long exchangeVersion) {}

    Opened open(UUID task, UUID operation, Issue.Kind kind, String reason, Object content, Evidence evidence);
    UUID temporary(UUID task);
    void delay(UUID id, String reason);
    List<UUID> confirm(UUID task);
    void protocol(UUID id, String reason, Evidence evidence);
    UUID observationIssue(UUID task);
    StoredIssue get(UUID id, boolean lock);
    long count(Issue.Status status);
    List<StoredIssue> list(int page, int size, Issue.Status status);
    void assign(UUID id, UUID operator);
    UUID active(UUID task);
    void saveReconciliation(Reconciliation value, long version);
    SavedReconciliation reconciliation(UUID task, UUID id);
    Map<UUID,SavedReconciliation> reconciliations(List<UUID> ids);
    void resumeDelivery(UUID id,String summary);
    void resolve(UUID id, IssueResolution resolution);
}
