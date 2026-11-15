package com.azhukov.integration.repository.springdata;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.HistoryEntry;
import com.azhukov.integration.repository.TaskReadRepository;
import com.azhukov.integration.repository.jdbc.TaskRowMapper;
import com.azhukov.integration.repository.mapping.TaskResultReader;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * Read-only adapter: Spring Data owns bounded card/history reads; the hot counted
 * registry uses parameterized SQL and the shared task mapper after measured aggregate
 * mapping overhead. The service owns the consistent page/count transaction.
 * No persistence rows or framework pagination types escape this adapter.
 * See docs/read-path-performance-plan.md and the measured E23 comparison.
 */
@Repository
@RequiredArgsConstructor
public class TaskReadRepositoryAdapter implements TaskReadRepository {
    private final TaskRows tasks;
    private final HistoryRows history;
    private final NamedParameterJdbcTemplate jdbc;
    private final TaskRowMapper rowMapper;
    private final TaskResultReader results;
    private final ObjectMapper json;

    @Override
    public Task get(UUID id, Actor actor) {
        var row = actor.isOperator() ? tasks.findById(id) : tasks.findByIdAndOwnerId(id, actor.id());
        return row.orElseThrow(RuleViolation::notFound).task(results);
    }

    @Override
    public Page<Task> page(
            Actor actor, int page, int size, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        var filters = new ArrayList<String>();
        var parameters = new MapSqlParameterSource();
        if (!actor.isOperator()) {
            filters.add("owner_id = :owner");
            parameters.addValue("owner", actor.id());
        }
        if (status != null) {
            filters.add("business_status = :status");
            parameters.addValue("status", status.name());
        }
        if (from != null) {
            filters.add("created_at >= :from");
            parameters.addValue("from", databaseBoundary(from));
        }
        if (to != null) {
            filters.add("created_at < :to");
            parameters.addValue("to", databaseBoundary(to));
        }
        String where = filters.isEmpty() ? "" : " WHERE " + String.join(" AND ", filters);
        parameters.addValue("limit", size).addValue("offset", (long) page * size);
        var rows =
                jdbc.query(
                        """
                        SELECT id,operation_id,owner_id,title,title_revision,request_reference,request_quantity,
                            delivery_status,business_status,created_at,accepted_result
                        FROM tasks
                        """
                                + where
                                + " ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset",
                        parameters,
                        rowMapper);
        long total = jdbc.queryForObject("SELECT count(*) FROM tasks" + where, parameters, Long.class);
        return new Page<>(rows, page, size, total);
    }

    /**
     * PostgreSQL stores microseconds, while the API accepts nanoseconds. Ceiling both
     * half-open bounds preserves comparisons against stored instants; driver rounding
     * to the nearest microsecond would include/exclude a neighboring record.
     */
    private static OffsetDateTime databaseBoundary(OffsetDateTime value) {
        int remainder = value.getNano() % 1000;
        return remainder == 0 ? value : value.plusNanos(1000 - remainder);
    }

    @Override
    public Page<HistoryEntry> history(Actor actor, UUID taskId, int page, int size) {
        get(taskId, actor);
        var rows = history.findByTaskId(taskId, size, (long) page * size);
        long total = history.countByTaskId(taskId);
        return new Page<>(rows.stream().map(row -> row.entry(json)).toList(), page, size, total);
    }
}
