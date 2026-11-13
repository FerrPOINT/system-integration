package com.azhukov.integration.tasks;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.task.TaskTitle;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Service
public class TaskService {
    private final TaskRepository tasks;
    private final CommandReceipts commands;

    public TaskService(TaskRepository tasks, CommandReceipts commands) {
        this.tasks = tasks;
        this.commands = commands;
    }

    @Transactional(readOnly = true)
    public Task get(AppUser user, UUID id) { return tasks.get(id, user, false); }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public TaskPage list(AppUser user, int page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        checkPage(page);
        if ((from != null && !from.getOffset().equals(ZoneOffset.UTC)) ||
            (to != null && !to.getOffset().equals(ZoneOffset.UTC)) ||
            (from != null && to != null && !to.isAfter(from)))
            throw RuleViolation.invalid("Укажите корректный период в UTC: начало включено, конец исключён");
        var rows = tasks.list(user, page, status, from, to);
        long total = tasks.countTasks(user, status, from, to);
        long pages = (total + 19) / 20;
        return new TaskPage(rows, page, (long) page + 1 < pages, total, pages);
    }

    @Transactional
    public CreateTaskResult create(AppUser user, UUID key, CreateTaskRequest input) {
        requireInitiator(user);
        return commands.execute(user.id(), "CREATE_TASK", key, input, 201, CreateTaskResult.class, () -> {
            var task = tasks.insert(user.id(), input);
            tasks.enqueue(task.getOperationId());
            tasks.history(task, user.id(), HistoryEvent.TypeEnum.CREATED, "Задание принято и поставлено в очередь");
            return new CreateTaskResult(task.getTaskId());
        });
    }

    @Transactional
    public RenameTaskResult rename(AppUser user, UUID key, UUID id, RenameTaskRequest input) {
        requireInitiator(user);
        // Check access even on receipt replay; a receipt must never expand visibility.
        tasks.get(id, user, false);
        return commands.execute(user.id(), "RENAME_TASK", key, new RenameCommand(id, input),
            200, RenameTaskResult.class, () -> {
                var task = tasks.get(id, user, true);
                var renamed = new TaskTitle(task.getTitle(),task.getTitleRevision())
                    .rename(input.getTitle(),input.getExpectedTitleRevision());
                tasks.rename(id, renamed.value(), renamed.revision());
                tasks.history(task, user.id(), HistoryEvent.TypeEnum.RENAMED,
                    "Название изменено: «" + task.getTitle() + "» → «" + input.getTitle() + "»");
                return new RenameTaskResult(renamed.value(), renamed.revision());
            });
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public HistoryPage history(AppUser user, UUID id, int page) {
        checkPage(page);
        tasks.get(id, user, false);
        var rows = tasks.history(id, page);
        long total = tasks.countHistory(id);
        long pages = (total + 19) / 20;
        return new HistoryPage(rows, page, (long) page + 1 < pages, total, pages);
    }

    private static void requireInitiator(AppUser user) {
        if (user.isOperator()) throw new RuleViolation(RuleViolation.Code.ACCESS_DENIED, "Действие доступно инициатору");
    }

    private static void checkPage(int page) {
        if (page < 0) throw RuleViolation.invalid("Номер страницы не может быть отрицательным");
    }

    private record RenameCommand(UUID taskId, RenameTaskRequest input) {}
}
