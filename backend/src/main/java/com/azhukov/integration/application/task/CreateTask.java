package com.azhukov.integration.application.task;

import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskTitle;
import java.util.Objects;
import java.util.UUID;

public record CreateTask(String title, TaskInput request) {
    public CreateTask {
        Objects.requireNonNull(request);
        new TaskTitle(title,1);
    }
    public record Result(UUID taskId) {}
}
