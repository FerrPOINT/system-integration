package com.azhukov.emulator;

import com.azhukov.integration.contract.external.model.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Service
class OperationService {
    private final OperationRepository operations;

    OperationService(OperationRepository operations) { this.operations = operations; }
    record Accepted(OperationState operation, boolean created, boolean dropResponse) {}

    @Transactional
    public Accepted accept(UUID id, OperationInput input) {
        operations.lockOperation(id);
        if (operations.exists(id)) {
            var operation = operations.get(id);
            if (!operation.getRequest().equals(input)) throw new EmulatorProblem(409, "OPERATION_CONFLICT");
            return new Accepted(operation, false, false);
        }
        var fault = operations.lockFault(input.getReference());
        String mode = fault != null && fault.bound() == null ? fault.mode() : "";
        if (mode.equals("UNAVAILABLE")) throw new EmulatorProblem(503, "UNAVAILABLE");
        operations.insert(id,input);
        if (!mode.isEmpty()) operations.bindFault(input.getReference(),id);
        if (mode.equals("DROP_RESPONSE_AFTER_EXECUTION")) execute(operations.get(id), mode);
        return new Accepted(operations.get(id), true, mode.equals("DROP_RESPONSE_AFTER_EXECUTION"));
    }

    @Transactional
    public boolean executeNext() {
        var rows = operations.lockNext();
        if (rows.isEmpty()) return false;
        var operation = rows.getFirst();
        execute(operation, operations.fault(operation.getOperationId()));
        return true;
    }

    private void execute(OperationState operation, String mode) {
        var now = OffsetDateTime.now(ZoneOffset.UTC);
        var running = new Result(operation.getOperationId(), operation.getRequest(), Result.VersionEnum.NUMBER_1, Result.StatusEnum.RUNNING);
        boolean rejected = operation.getRequest().getQuantity() > 100;
        var result = new Result(operation.getOperationId(), operation.getRequest(), Result.VersionEnum.NUMBER_2,
            rejected ? Result.StatusEnum.REJECTED : Result.StatusEnum.SUCCEEDED).completedAt(now);
        if (rejected) result.setRejectionCode("QUANTITY_LIMIT_EXCEEDED");
        operations.complete(result);
        boolean drop = mode.equals("DROP_RESPONSE_AFTER_EXECUTION");
        operations.event(running, 0, drop || mode.equals("DELAY_RESULT"));
        operations.event(result, 0, drop);
        if (mode.equals("DUPLICATE_RESULT")) operations.event(result, 1, false);
    }

    @Transactional
    public boolean publishNext() {
        return operations.publishNext();
    }

    @Transactional
    public void configure(String reference, String mode) {
        operations.lockFaultConfiguration(reference);
        var fault = operations.lockFault(reference);
        if (fault != null && fault.mode().equals(mode)) return;
        if (fault != null && fault.bound() != null) throw new EmulatorProblem(409,"FAULT_ALREADY_BOUND");
        operations.configure(reference,mode);
    }

    @Transactional
    public void clear(String reference) {
        operations.clear(reference);
    }

}
