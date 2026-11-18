package com.azhukov.emulator.service;

import com.azhukov.emulator.domain.*;
import com.azhukov.emulator.repository.OperationRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Owns atomic accept/execute/publish transactions. Completion and result events
 * commit together; a reused operation ID must retain its original request.
 * Publication is bounded by MAX_PUBLICATION_BATCH.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OperationService {
    public static final int MAX_PUBLICATION_BATCH = 100;
    public static final int MAX_EXECUTION_BATCH = 25;
    private final OperationRepository operations;

    public record Accepted(Operation operation, boolean created, boolean dropResponse) {}

    @Transactional
    public Accepted accept(UUID id, OperationRequest input) {
        operations.lockOperation(id);
        var existing = operations.find(id);
        if (existing.isPresent()) {
            var operation = existing.get();
            operation.requireRequest(input);
            auditAfterCommit("replayed", id, "executions=" + operation.executions());
            return new Accepted(operation, false, false);
        }
        var fault = operations.lockFault(id);
        if (fault == FaultMode.UNAVAILABLE) throw new RuleViolation(RuleViolation.Code.UNAVAILABLE);
        var mode = fault == null ? FaultMode.NONE : fault;
        var operation = operations.insert(id, input);
        auditAfterCommit("accepted", id, "mode=" + mode.name());
        if (mode == FaultMode.DROP_RESPONSE_AFTER_EXECUTION) {
            execute(operation, mode);
            return new Accepted(operations.get(id), true, true);
        }
        return new Accepted(operation, true, false);
    }

    @Transactional(readOnly = true)
    public Operation get(UUID id) {
        return operations.get(id);
    }

    @Transactional(readOnly = true)
    public List<ResultEvent> events(long after, int limit) {
        return operations.events(after, limit);
    }

    /**
     * Executes one bounded, atomic group. Locks are skipped by competing workers;
     * operation results and their events roll back together on any failure.
     * Grouping commits reduces transaction overhead without changing fault rules.
     */
    @Transactional
    public int executeNext(int limit) {
        if (limit < 1 || limit > MAX_EXECUTION_BATCH) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        var rows = operations.lockNext(limit);
        var modes = operations.faults(rows.stream().map(Operation::operationId).toList());
        for (var operation : rows) execute(operation, modes.getOrDefault(operation.operationId(), FaultMode.NONE));
        return rows.size();
    }

    private void execute(Operation operation, FaultMode mode) {
        var execution = operation.execute(mode, OffsetDateTime.now(ZoneOffset.UTC));
        operations.complete(execution.result());
        for (var event : execution.events()) operations.event(event.result(), event.copy(), event.held());
        auditAfterCommit("executed", operation.operationId(), "result=" + execution.result().status().name());
    }

    @Transactional
    public int publish(int limit) {
        if (limit < 1 || limit > MAX_PUBLICATION_BATCH) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        int count = operations.publish(limit);
        if (count > 0) auditAfterCommit("published", null, "count=" + count);
        return count;
    }

    @Transactional
    public void configure(UUID id, FaultMode mode) {
        if (mode == null || mode == FaultMode.NONE) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        operations.lockOperation(id);
        if (operations.lockFault(id) == mode) return;
        if (operations.find(id).isPresent()) throw new RuleViolation(RuleViolation.Code.FAULT_ALREADY_BOUND);
        operations.configure(id, mode);
        auditAfterCommit("fault-configured", id, "mode=" + mode.name());
    }

    @Transactional
    public void clear(UUID id) {
        operations.lockOperation(id);
        var fault = operations.lockFault(id);
        if (fault == null) return;
        operations.releaseEvents(id);
        operations.clearFault(id);
        auditAfterCommit("fault-cleared", id, "mode=" + fault.name());
    }

    // The transaction owns success: a rolled-back execution must not appear committed in logs.
    private void auditAfterCommit(String event, UUID operation, String detail) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        log.info("emulator event={} operationId={} detail={}", event, operation, detail);
                    }
                });
    }
}
