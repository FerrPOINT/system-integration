package com.azhukov.integration.dto;

/** Stable codes persisted with command receipts. */
public enum CommandType {
    CREATE_TASK, RENAME_TASK, RECONCILE, TAKE_ISSUE, RETRY_EXCHANGE, RESOLVE_ISSUE
}
