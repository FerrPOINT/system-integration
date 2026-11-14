package com.azhukov.integration.repository.jdbc;

import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.repository.mapping.TaskResultReader;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskOutcome;
import com.azhukov.integration.domain.task.TaskTitle;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
@RequiredArgsConstructor
public class TaskRowMapper implements RowMapper<Task> {
    private final ObjectMapper json;
    private final TaskResultReader results;

    @Override
    public Task mapRow(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        var business = BusinessStatus.valueOf(rs.getString("business_status"));
        var stored = rs.getString("accepted_result");
        return mapTask(rs,business,results.outcome(business,stored));
    }

    private OperationResult storedResult(java.sql.ResultSet rs) throws java.sql.SQLException {
        var value = rs.getString("accepted_result");
        return value == null ? null : json.readValue(value,OperationResult.class);
    }

    private Task mapTask(java.sql.ResultSet rs, BusinessStatus business, TaskOutcome outcome) throws java.sql.SQLException {
        return new Task(rs.getObject("id",UUID.class),rs.getObject("operation_id",UUID.class),
            rs.getObject("owner_id",UUID.class),new TaskTitle(rs.getString("title"),rs.getLong("title_revision")),
            new TaskInput(rs.getString("request_reference"),rs.getInt("request_quantity")),
            DeliveryStatus.valueOf(rs.getString("delivery_status")),business,
            rs.getObject("created_at",OffsetDateTime.class),outcome);
    }

    ExchangeState exchange(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        var business = BusinessStatus.valueOf(rs.getString("business_status"));
        var result = storedResult(rs);
        var outcome = result != null && business.isTerminal()
            ? new TaskOutcome(result.status(),result.completedAt(),result.rejectionCode())
            : null;
        return new ExchangeState(mapTask(rs,business,outcome),rs.getLong("exchange_version"),result);
    }
}
