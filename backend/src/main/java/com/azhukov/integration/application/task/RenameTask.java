package com.azhukov.integration.application.task;

public record RenameTask(String title, long expectedTitleRevision) {
    public record Result(String title, long titleRevision) {}
}
