package com.azhukov.integration.web;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.tasks.TaskService;
import com.azhukov.integration.contract.internal.api.TasksApi;
import com.azhukov.integration.contract.internal.model.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.UUID;

@RestController
public class TasksController implements TasksApi {
    private final TaskService tasks;

    public TasksController(TaskService tasks) { this.tasks = tasks; }

    @Override
    public ResponseEntity<CreateTaskResult> createTask(String csrf, UUID key, CreateTaskRequest input) {
        return ResponseEntity.status(201).body(tasks.create(AppUser.current().actor(), key, input));
    }

    @Override
    public ResponseEntity<Task> getTask(UUID id) { return ResponseEntity.ok(tasks.get(AppUser.current().actor(), id)); }

    @Override
    public ResponseEntity<TaskPage> listTasks(Integer page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        return ResponseEntity.ok(tasks.list(AppUser.current().actor(), page, status, from, to));
    }

    @Override
    public ResponseEntity<RenameTaskResult> renameTask(String csrf, UUID key, UUID id, RenameTaskRequest input) {
        return ResponseEntity.ok(tasks.rename(AppUser.current().actor(), key, id, input));
    }

    @Override
    public ResponseEntity<HistoryPage> listTaskHistory(UUID id, Integer page) {
        return ResponseEntity.ok(tasks.history(AppUser.current().actor(), id, page));
    }
}
