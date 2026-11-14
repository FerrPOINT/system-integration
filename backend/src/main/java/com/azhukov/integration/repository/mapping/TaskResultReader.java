package com.azhukov.integration.repository.mapping;

import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.TaskOutcome;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** One interpretation of stored result JSON for both JDBC and Spring Data UI reads. */
@Component
@RequiredArgsConstructor
public class TaskResultReader {
    private final ObjectMapper json;

    /** Nonterminal cards intentionally do not decode the stored protocol snapshot. */
    public TaskOutcome outcome(BusinessStatus status, String stored) {
        if (stored == null || !status.isTerminal()) return null;
        var result = json.readTree(stored);
        return new TaskOutcome(BusinessStatus.valueOf(result.get("status").asString()),
            OffsetDateTime.parse(result.get("completedAt").asString()),
            result.has("rejectionCode") ? result.get("rejectionCode").asString() : null);
    }
}
