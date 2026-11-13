package com.azhukov.integration.application.port;

import java.util.UUID;
import java.util.function.Supplier;

public interface CommandReceiptStore {
    enum Command { CREATE_TASK, RENAME_TASK, RECONCILE, TAKE_ISSUE, RETRY_EXCHANGE, RESOLVE_ISSUE }
    <T> T execute(UUID actor, Command command, UUID key, Object input, Class<T> type, Supplier<T> operation);
}
