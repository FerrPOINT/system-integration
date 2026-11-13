package com.azhukov.emulator.application;

import lombok.RequiredArgsConstructor;
import com.azhukov.emulator.application.port.OperationStore;
import com.azhukov.emulator.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class OperationService {
    public static final int MAX_PUBLICATION_BATCH=100;
    private final OperationStore operations;

    public record Accepted(Operation operation,boolean created,boolean dropResponse) {}

    @Transactional
    public Accepted accept(UUID id,OperationRequest input) {
        operations.lockOperation(id);
        if (operations.exists(id)) {
            var operation=operations.get(id);
            operation.requireRequest(input);
            return new Accepted(operation,false,false);
        }
        var fault=operations.lockFault(input.reference());
        var mode=fault==null ? FaultMode.NONE : fault.forNextAcceptance();
        operations.insert(id,input);
        if (mode!=FaultMode.NONE) operations.bindFault(input.reference(),id);
        if (mode==FaultMode.DROP_RESPONSE_AFTER_EXECUTION) execute(operations.get(id),mode);
        return new Accepted(operations.get(id),true,mode==FaultMode.DROP_RESPONSE_AFTER_EXECUTION);
    }

    @Transactional(readOnly=true)
    public Operation get(UUID id) { return operations.get(id); }

    @Transactional(readOnly=true)
    public List<ResultEvent> events(long after,int limit) { return operations.events(after,limit); }

    @Transactional
    public boolean executeNext() {
        var rows=operations.lockNext();
        if (rows.isEmpty()) return false;
        var operation=rows.getFirst();
        execute(operation,operations.fault(operation.operationId()));
        return true;
    }

    private void execute(Operation operation,FaultMode mode) {
        var execution=operation.execute(mode,OffsetDateTime.now(ZoneOffset.UTC));
        operations.complete(execution.result());
        for (var event:execution.events()) operations.event(event.result(),event.copy(),event.held());
    }

    @Transactional
    public int publish(int limit) {
        if (limit<1 || limit>MAX_PUBLICATION_BATCH) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        return operations.publish(limit);
    }

    @Transactional
    public void configure(String reference,FaultMode mode) {
        if (mode==null || mode==FaultMode.NONE) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        operations.lockFaultConfiguration(reference);
        var fault=operations.lockFault(reference);
        if (fault!=null && !fault.changeTo(mode)) return;
        operations.configure(reference,mode);
    }

    @Transactional
    public void clear(String reference) {
        var fault=operations.lockFault(reference);
        if (fault!=null && fault.bound()!=null) operations.releaseEvents(fault.bound());
        operations.clearFault(reference);
    }
}
