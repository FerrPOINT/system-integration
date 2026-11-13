package com.azhukov.integration.service;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.CommandType;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.dto.task.HistoryEntry;
import com.azhukov.integration.dto.task.RenameTask;
import com.azhukov.integration.repository.ExchangeRepository;
import com.azhukov.integration.repository.TaskRepository;
import com.azhukov.integration.service.idempotency.IdempotencyService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class TaskService {
    private final TaskRepository tasks;
    private final ExchangeRepository exchange;
    private final IdempotencyService commands;

    @Transactional(readOnly = true)
    public Task get(Actor user, UUID id) { return tasks.get(id, user, false); }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<Task> list(Actor user, int page, int size, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        Page.requireValid(page,size);
        if ((from != null && !from.getOffset().equals(ZoneOffset.UTC)) ||
            (to != null && !to.getOffset().equals(ZoneOffset.UTC)) ||
            (from != null && to != null && !to.isAfter(from)))
            throw RuleViolation.invalid("Укажите корректный период в UTC: начало включено, конец исключён");
        var rows = tasks.list(user, page, size, status, from, to);
        long total = tasks.countTasks(user, status, from, to);
        return new Page<>(rows,page,size,total);
    }

    @Transactional
    public CreateTask.Result create(Actor user, UUID key, CreateTask input) {
        requireInitiator(user);
        return commands.execute(user.id(), CommandType.CREATE_TASK, key, input, CreateTask.Result.class, () -> {
            var task = tasks.insert(user.id(), input);
            exchange.enqueue(task.operationId());
            tasks.history(task, user.id(), HistoryType.CREATED, "Задание принято и поставлено в очередь");
            return new CreateTask.Result(task.id());
        });
    }

    @Transactional
    public RenameTask.Result rename(Actor user, UUID key, UUID id, RenameTask input) {
        requireInitiator(user);
        // Check access even on receipt replay; a receipt must never expand visibility.
        tasks.get(id, user, false);
        return commands.execute(user.id(), CommandType.RENAME_TASK, key, new RenameCommand(id, input),
            RenameTask.Result.class, () -> {
                var task = tasks.get(id, user, true);
                var renamed = task.rename(input.title(),input.expectedTitleRevision());
                tasks.rename(id, renamed.title().value(), renamed.title().revision());
                tasks.history(task, user.id(), HistoryType.RENAMED,
                    "Название изменено: «" + task.title().value() + "» → «" + input.title() + "»");
                return new RenameTask.Result(renamed.title().value(), renamed.title().revision());
            });
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<HistoryEntry> history(Actor user, UUID id, int page, int size) {
        Page.requireValid(page,size);
        tasks.get(id, user, false);
        var rows = tasks.history(id, page, size);
        long total = tasks.countHistory(id);
        return new Page<>(rows,page,size,total);
    }

    private static void requireInitiator(Actor user) {
        if (user.isOperator()) throw new RuleViolation(RuleViolation.Code.ACCESS_DENIED, "Действие доступно инициатору");
    }

    private record RenameCommand(UUID taskId, RenameTask input) {}
}
