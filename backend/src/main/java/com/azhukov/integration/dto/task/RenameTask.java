package com.azhukov.integration.dto.task;

public record RenameTask(String title, long expectedTitleRevision) {
    public record Result(String title, long titleRevision) {}
}
