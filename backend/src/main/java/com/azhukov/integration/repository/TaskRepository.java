package com.azhukov.integration.repository;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.dto.task.HistoryEntry;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface TaskRepository {
    Task get(UUID id, Actor user, boolean lock);
    List<Task> list(Actor user, int page, int size, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    long countTasks(Actor user, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    Task insert(UUID owner, CreateTask input);
    void rename(UUID id, String title, long revision);
    void observe(Task task, UUID issue, OperationResult result, String summary);
    void history(Task task, UUID actorId, HistoryType type, String summary);
    void history(Task task, UUID actorId, HistoryType type, String summary, Object details);
    List<HistoryEntry> history(UUID id, int page, int size);
    long countHistory(UUID id);
}
