package com.azhukov.integration.dto.exchange;

/** Activity of other client sessions of the same database and user; no SQL text or identifiers. */
public record DatabaseActivity(long blockedSessions, long idleTransactions, long oldestTransactionSeconds) {}
