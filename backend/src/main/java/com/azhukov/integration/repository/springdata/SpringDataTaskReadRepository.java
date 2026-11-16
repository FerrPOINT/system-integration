package com.azhukov.integration.repository.springdata;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.HistoryEntry;
import com.azhukov.integration.repository.TaskReadRepository;
import com.azhukov.integration.repository.mapping.TaskResultReader;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jdbc.core.JdbcAggregateOperations;
import org.springframework.data.relational.core.query.Criteria;
import org.springframework.data.relational.core.query.Query;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/**
 * Spring Data owns simple row mapping and SELECT generation; services own access
 * context and the transaction. Dynamic criteria avoid a finder per filter combination.
 * There are no persistence DTOs or framework pagination types in the application port.
 */
@Repository
@RequiredArgsConstructor
public class SpringDataTaskReadRepository implements TaskReadRepository {
    private final TaskRows tasks;
    private final HistoryRows history;
    private final JdbcAggregateOperations aggregates;
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
        var criteria = Criteria.empty();
        if (!actor.isOperator()) criteria = criteria.and("ownerId").is(actor.id());
        if (status != null) criteria = criteria.and("businessStatus").is(status);
        if (from != null) criteria = criteria.and("createdAt").greaterThanOrEquals(from);
        if (to != null) criteria = criteria.and("createdAt").lessThan(to);
        var query = Query.query(criteria);
        var pagination = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt", "id"));
        var rows = aggregates.findAll(query.with(pagination), TaskReadRow.class);
        long total = aggregates.count(query, TaskReadRow.class);
        return new Page<>(rows.stream().map(row -> row.task(results)).toList(), page, size, total);
    }

    @Override
    public Page<HistoryEntry> history(Actor actor, UUID taskId, int page, int size) {
        get(taskId, actor);
        var pagination = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "occurredAt", "id"));
        var rows = history.findByTaskId(taskId, pagination);
        long total = history.countByTaskId(taskId);
        return new Page<>(rows.stream().map(row -> row.entry(json)).toList(), page, size, total);
    }
}
