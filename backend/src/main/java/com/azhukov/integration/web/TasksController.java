package com.azhukov.integration.web;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.application.TaskService;
import com.azhukov.integration.application.task.CreateTask;
import com.azhukov.integration.application.task.RenameTask;
import com.azhukov.integration.application.task.HistoryEntry;
import com.azhukov.integration.domain.task.TaskInput;
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
        var command = new CreateTask(input.getTitle(),new TaskInput(input.getRequest().getReference(),input.getRequest().getQuantity()));
        return ResponseEntity.status(201).body(new CreateTaskResult(tasks.create(AppUser.current().actor(), key, command).taskId()));
    }

    @Override
    public ResponseEntity<Task> getTask(UUID id) { return ResponseEntity.ok(view(tasks.get(AppUser.current().actor(), id))); }

    @Override
    public ResponseEntity<TaskPage> listTasks(Integer page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        var result = tasks.list(AppUser.current().actor(), page,
            status == null ? null : com.azhukov.integration.domain.task.BusinessStatus.valueOf(status.getValue()), from, to);
        return ResponseEntity.ok(new TaskPage(result.items().stream().map(TasksController::view).toList(),
            result.page(),result.hasNext(),result.totalItems(),result.totalPages()));
    }

    @Override
    public ResponseEntity<RenameTaskResult> renameTask(String csrf, UUID key, UUID id, RenameTaskRequest input) {
        var result = tasks.rename(AppUser.current().actor(), key, id, new RenameTask(input.getTitle(),input.getExpectedTitleRevision()));
        return ResponseEntity.ok(new RenameTaskResult(result.title(),result.titleRevision()));
    }

    @Override
    public ResponseEntity<HistoryPage> listTaskHistory(UUID id, Integer page) {
        var result = tasks.history(AppUser.current().actor(), id, page);
        return ResponseEntity.ok(new HistoryPage(result.items().stream().map(TasksController::view).toList(),
            result.page(),result.hasNext(),result.totalItems(),result.totalPages()));
    }
    private static Task view(com.azhukov.integration.domain.task.Task value) {
        var task = new Task(value.id(),value.operationId(),value.ownerId(),value.title().value(),value.title().revision(),
            new Request(value.request().reference(),value.request().quantity()),
            DeliveryStatus.fromValue(value.deliveryStatus().name()),BusinessStatus.fromValue(value.businessStatus().name()),value.createdAt());
        if (value.outcome() != null) {
            var outcome = value.outcome();
            task.result(new TaskResult(TaskResult.StatusEnum.fromValue(outcome.status().name()),outcome.completedAt())
                .rejectionCode(outcome.rejectionCode() == null ? null : TaskResult.RejectionCodeEnum.fromValue(outcome.rejectionCode())));
        }
        return task;
    }
    private static HistoryEvent view(HistoryEntry value) {
        return new HistoryEvent(value.eventId(),value.taskId(),value.operationId(),value.occurredAt(),
            HistoryEvent.ActorEnum.fromValue(value.actor().name()),HistoryEvent.TypeEnum.fromValue(value.type().name()),value.summary())
            .actorUserId(value.actorUserId()).attemptId(value.attemptId())
            .resultVersion(value.resultVersion() == null ? null : HistoryEvent.ResultVersionEnum.fromValue(value.resultVersion()))
            .issueId(value.issueId()).reconciliationId(value.reconciliationId())
            .previousAssigneeId(value.previousAssigneeId()).assignedTo(value.assignedTo());
    }
}
