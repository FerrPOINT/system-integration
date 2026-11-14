package com.azhukov.integration.repository;

import com.azhukov.integration.dto.CommandType;
import java.util.Optional;
import java.util.UUID;

/**
 * Durable receipts keyed by actor, command and key, never by key alone.
 * The service locks that identity before replay or callback/save in one transaction;
 * a conflicting fingerprint fails instead of replaying another command.
 */
public interface CommandReceiptRepository {
    void lock(UUID actor, CommandType command, UUID key);
    Optional<Receipt> find(UUID actor, CommandType command, UUID key);
    void insert(UUID actor, CommandType command, UUID key, String fingerprint, int status, String body);

    record Receipt(String fingerprint, String body) {}
}
