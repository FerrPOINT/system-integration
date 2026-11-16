package com.azhukov.integration.repository.springdata;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jdbc.repository.query.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Bounded history with a single author JOIN, avoiding per-event lookups. Explicit
 * SELECT is needed for the read-only display projection; COUNT remains generated.
 * Callers must verify task visibility before either query.
 */
interface HistoryRows extends Repository<HistoryReadRow, UUID> {
    @Query(
            """
            SELECT h.*,u.username AS actor_username
            FROM task_history h LEFT JOIN users u ON u.id = h.actor_user_id
            WHERE h.task_id = :taskId
            ORDER BY h.occurred_at DESC,h.id DESC LIMIT :limit OFFSET :offset
            """)
    List<HistoryReadRow> findByTaskId(
            @Param("taskId") UUID taskId, @Param("limit") int limit, @Param("offset") long offset);

    long countByTaskId(UUID taskId);
}
