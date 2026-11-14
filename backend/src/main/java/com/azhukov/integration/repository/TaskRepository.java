package com.azhukov.integration.repository;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.Task;
import com.azhukov.integration.dto.task.CreateTask;
import java.util.UUID;

/**
 * Command task storage in the caller's transaction with queue, history and receipt.
 * get(lock=true) holds FOR UPDATE until commit; get(false) still checks ownership
 * before receipt replay. Missing and foreign IDs both give NOT_FOUND.
 */
public interface TaskRepository {
    /**
     * Loads visible command state; missing/foreign IDs both give NOT_FOUND.
     * @param id task identity
     * @param user authenticated actor
     * @param lock whether FOR UPDATE must be held until the caller commits
     * @return state against which the command is validated
     */
    Task get(UUID id, Actor user, boolean lock);
    Task insert(UUID owner, CreateTask input);
    void rename(UUID id, String title, long revision);
    void observe(Task task, UUID issue, OperationResult result, String summary);
    void history(Task task, UUID actorId, HistoryType type, String summary);
    void history(Task task, UUID actorId, HistoryType type, String summary, Object details);
}
