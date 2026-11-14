package com.azhukov.emulator.service;

import com.azhukov.emulator.domain.*;
import com.azhukov.emulator.repository.OperationRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns atomic accept/execute/publish transactions. Completion and result events
 * commit together; a reused operation ID must retain its original request.
 * Publication is bounded by MAX_PUBLICATION_BATCH.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class OperationService {
    public static final int MAX_PUBLICATION_BATCH=100;
    private final OperationRepository operations;

    public record Accepted(Operation operation,boolean created,boolean dropResponse) {}

    @Transactional
    public Accepted accept(UUID id,OperationRequest input) {
        operations.lockOperation(id);
        if (operations.exists(id)) {
            var operation=operations.get(id);
            operation.requireRequest(input);
            auditAfterCommit("replayed",id,"executions="+operation.executions());
            return new Accepted(operation,false,false);
        }
        var fault=operations.lockFault(input.reference());
        var mode=fault==null ? FaultMode.NONE : fault.forNextAcceptance();
        operations.insert(id,input);
        auditAfterCommit("accepted",id,"mode="+mode.name());
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
        auditAfterCommit("executed",operation.operationId(),"result="+execution.result().status().name());
    }

    @Transactional
    public int publish(int limit) {
        if (limit<1 || limit>MAX_PUBLICATION_BATCH) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        int count=operations.publish(limit);
        if (count>0) auditAfterCommit("published",null,"count="+count);
        return count;
    }

    @Transactional
    public void configure(String reference,FaultMode mode) {
        if (mode==null || mode==FaultMode.NONE) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
        operations.lockFaultConfiguration(reference);
        var fault=operations.lockFault(reference);
        if (fault!=null && !fault.changeTo(mode)) return;
        operations.configure(reference,mode);
        auditAfterCommit("fault-configured",null,"reference="+reference+",mode="+mode.name());
    }

    @Transactional
    public void clear(String reference) {
        var fault=operations.lockFault(reference);
        if (fault!=null && fault.bound()!=null) operations.releaseEvents(fault.bound());
        operations.clearFault(reference);
        if (fault!=null) auditAfterCommit("fault-cleared",fault.bound(),"reference="+reference);
    }

    // The transaction owns success: a rolled-back execution must not appear committed in logs.
    private void auditAfterCommit(String event,UUID operation,String detail) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                log.info("emulator event={} operationId={} detail={}",event,operation,detail);
            }
        });
    }
}
