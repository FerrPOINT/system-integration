package com.azhukov.integration.application.port;

import com.azhukov.integration.application.Actor;
import com.azhukov.integration.application.task.CreateTask;
import com.azhukov.integration.application.task.HistoryEntry;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface TaskStore {
    Task get(UUID id, Actor user, boolean lock);
    List<Task> list(Actor user, int page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    long countTasks(Actor user, BusinessStatus status, OffsetDateTime from, OffsetDateTime to);
    Task insert(UUID owner, CreateTask input);
    void enqueue(UUID operationId);
    void rename(UUID id, String title, long revision);
    void history(Task task, UUID actorId, HistoryType type, String summary);
    List<HistoryEntry> history(UUID id, int page);
    long countHistory(UUID id);
}
