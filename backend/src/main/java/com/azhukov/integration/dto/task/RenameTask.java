package com.azhukov.integration.dto.task;

import com.azhukov.integration.domain.task.TaskTitle;

public record RenameTask(String title, long expectedTitleRevision) {
    public RenameTask {
        // Validate before receipt lookup, including malformed UTF-16 which UTF-8 hashing would replace.
        new TaskTitle(title, expectedTitleRevision);
    }

    public record Result(String title, long titleRevision) {}
}
