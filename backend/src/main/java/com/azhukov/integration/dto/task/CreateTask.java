package com.azhukov.integration.dto.task;

import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskTitle;
import java.util.UUID;

public record CreateTask(String title, int quantity) {
    public CreateTask {
        new TaskInput(quantity);
        new TaskTitle(title, 1);
    }

    public record Result(UUID taskId) {}
}
