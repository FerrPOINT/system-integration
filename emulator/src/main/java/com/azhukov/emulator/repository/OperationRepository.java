package com.azhukov.emulator.repository;

import com.azhukov.emulator.domain.*;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface OperationRepository {
    Operation get(UUID id);

    Optional<Operation> find(UUID id);

    List<Operation> lockNext(int limit);

    List<ResultEvent> events(long after, int limit);

    /** Locks configured fault modes for an already selected bounded execution batch. */
    Map<UUID, FaultMode> faults(List<UUID> ids);

    void event(OperationResult result, int copy, boolean held);

    void lockOperation(UUID id);

    Fault lockFault(String reference);

    /** Returns the stored snapshot, including the database-assigned acceptance time. */
    Operation insert(UUID id, OperationRequest input);

    void bindFault(String reference, UUID id);

    void complete(OperationResult result);

    int publish(int limit);

    void lockFaultConfiguration(String reference);

    void configure(String reference, FaultMode mode);

    void releaseEvents(UUID operation);

    void clearFault(String reference);
}
