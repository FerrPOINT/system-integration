package com.azhukov.integration.tasks;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.http.ApiProblem;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    @Transactional(readOnly = true)
    public TaskPage list(AppUser user, int page, BusinessStatus status, OffsetDateTime from, OffsetDateTime to) {
        checkPage(page);
        if ((from != null && !from.getOffset().equals(ZoneOffset.UTC)) ||
            (to != null && !to.getOffset().equals(ZoneOffset.UTC)) ||
            (from != null && to != null && !to.isAfter(from)))
            throw ApiProblem.invalid("Укажите корректный период в UTC: начало включено, конец исключён");
        var rows = tasks.list(user, page, status, from, to);
        return new TaskPage(rows.stream().limit(20).toList(), page, rows.size() > 20);
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
                if (!task.getTitleRevision().equals(input.getExpectedTitleRevision()))
                    throw new ApiProblem(409, "TITLE_REVISION_CONFLICT", "Название уже изменено. Обновите карточку");
                long revision = Math.addExact(task.getTitleRevision(), 1);
                if (revision > 9007199254740991L) throw ApiProblem.invalid("Достигнут предел версии");
                tasks.rename(id, input.getTitle(), revision);
                tasks.history(task, user.id(), HistoryEvent.TypeEnum.RENAMED,
                    "Название изменено: «" + task.getTitle() + "» → «" + input.getTitle() + "»");
                return new RenameTaskResult(input.getTitle(), revision);
            });
    }

    @Transactional(readOnly = true)
    public HistoryPage history(AppUser user, UUID id, int page) {
        checkPage(page);
        tasks.get(id, user, false);
        var rows = tasks.history(id, page);
        return new HistoryPage(rows.stream().limit(20).toList(), page, rows.size() > 20);
    }

    private static void requireInitiator(AppUser user) {
        if (user.isOperator()) throw new ApiProblem(403, "ACCESS_DENIED", "Действие доступно инициатору");
    }

    private static void checkPage(int page) {
        if (page < 0) throw ApiProblem.invalid("Номер страницы не может быть отрицательным");
    }

    private record RenameCommand(UUID taskId, RenameTaskRequest input) {}
}
