package com.azhukov.integration.repository.springdata;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

/** Generated history SELECT/COUNT; callers must check task visibility before querying. */
interface HistoryRows extends Repository<HistoryReadRow,UUID> {
    List<HistoryReadRow> findByTaskId(UUID taskId, Pageable page);
    long countByTaskId(UUID taskId);
}
