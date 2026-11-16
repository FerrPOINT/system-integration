package com.azhukov.integration.repository;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.HistoryEntry;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Bounded UI reads of committed task state, independent of the storage mechanism.
 * Services validate page/UTC input and supply a read-only transaction; counted
 * pages require REPEATABLE_READ so rows and totals describe one snapshot.
 * No method changes tasks, history, receipts or delivery state.
 */
public interface TaskReadRepository {
    /** Returns a visible task; missing and foreign IDs both raise NOT_FOUND. */
    Task get(UUID id, Actor actor);

    /**
     * Reads an exact counted page, ordered by createdAt/id descending.
     * Initiators are scoped to their owner ID; operators see all owners.
     * The UTC interval includes from and excludes to; null bounds are omitted.
     */
    Page<Task> page(Actor actor, int page, int size, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);

    /**
     * Reads history by occurredAt/id descending after verifying task visibility.
     * Rows and count use the caller's snapshot; missing/foreign tasks give NOT_FOUND.
     */
    Page<HistoryEntry> history(Actor actor, UUID taskId, int page, int size);
}
