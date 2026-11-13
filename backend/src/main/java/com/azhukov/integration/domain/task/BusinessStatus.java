package com.azhukov.integration.domain.task;

public enum BusinessStatus {
    PENDING, RUNNING, SUCCEEDED, REJECTED;
    public boolean isTerminal() { return this == SUCCEEDED || this == REJECTED; }
}
