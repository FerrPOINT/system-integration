package com.azhukov.integration.controller;

import com.azhukov.integration.contract.internal.api.TasksApi;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.mapper.TaskApiMapper;
import com.azhukov.integration.security.AppUser;
import com.azhukov.integration.service.TaskService;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class TasksController implements TasksApi {
    private final TaskService tasks;
    private final TaskApiMapper mapper;

    @Override
    public ResponseEntity<CreateTaskResult> createTask(String csrf, UUID key, CreateTaskRequest input) {
        var result = tasks.create(AppUser.current().actor(), key, mapper.create(input));
        return ResponseEntity.status(201).body(mapper.created(result));
    }

    @Override
    public ResponseEntity<Task> getTask(UUID id) {
        return ResponseEntity.ok(mapper.task(tasks.get(AppUser.current().actor(), id)));
    }

    @Override
    public ResponseEntity<TaskPage> listTasks(
            Integer page, Integer size, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        var result = tasks.list(AppUser.current().actor(), page, size, mapper.status(status), from, to);
        return ResponseEntity.ok(mapper.tasks(result));
    }

    @Override
    public ResponseEntity<RenameTaskResult> renameTask(String csrf, UUID key, UUID id, RenameTaskRequest input) {
        var result = tasks.rename(AppUser.current().actor(), key, id, mapper.rename(input));
        return ResponseEntity.ok(mapper.renamed(result));
    }

    @Override
    public ResponseEntity<HistoryPage> listTaskHistory(UUID id, Integer page, Integer size) {
        var result = tasks.history(AppUser.current().actor(), id, page, size);
        return ResponseEntity.ok(mapper.history(result));
    }
}
