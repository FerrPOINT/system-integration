package com.azhukov.integration.repository.springdata;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.repository.Repository;

/** Generated single-row reads only; no unscoped collection, save or delete operations. */
interface TaskRows extends Repository<TaskReadRow, UUID> {
    Optional<TaskReadRow> findById(UUID id);

    Optional<TaskReadRow> findByIdAndOwnerId(UUID id, UUID ownerId);
}
