package com.azhukov.integration.application;

import com.azhukov.integration.domain.task.Task;
import java.util.List;

public record TaskPage(List<Task> items, int page, boolean hasNext, long totalItems, long totalPages) {
    public TaskPage { items = List.copyOf(items); }
}
