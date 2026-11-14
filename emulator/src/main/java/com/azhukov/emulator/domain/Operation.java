package com.azhukov.emulator.domain;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public record Operation(UUID operationId,OperationRequest request,OffsetDateTime acceptedAt,
                        int executions,OperationResult result) {
    public record Event(OperationResult result,int copy,boolean held) {}
    public record Execution(OperationResult result,List<Event> events) {
        public Execution { events=List.copyOf(events); }
    }

    public Operation {
        Objects.requireNonNull(operationId); Objects.requireNonNull(request); Objects.requireNonNull(acceptedAt);
        if ((executions!=0 && executions!=1) || (executions==0 && result!=null) ||
            (executions==1 && (result==null || result.version()!=2)))
            throw new IllegalArgumentException("Некорректное состояние исполнения");
        if (result!=null && (!operationId.equals(result.operationId()) || !request.equals(result.request())))
            throw new IllegalArgumentException("Результат принадлежит другой операции");
    }

    public void requireRequest(OperationRequest input) {
        if (!request.equals(input)) throw new RuleViolation(RuleViolation.Code.OPERATION_CONFLICT);
    }

    public Execution execute(FaultMode mode,OffsetDateTime now) {
        if (executions!=0) throw new IllegalStateException("Операция уже исполнена");
        var running=new OperationResult(operationId,request,1,OperationResult.Status.RUNNING,null,null);
        boolean rejected=request.quantity()>100;
        var terminal=new OperationResult(operationId,request,2,
            rejected ? OperationResult.Status.REJECTED : OperationResult.Status.SUCCEEDED,
            Objects.requireNonNull(now),rejected ? "QUANTITY_LIMIT_EXCEEDED" : null);
        boolean drop=mode==FaultMode.DROP_RESPONSE_AFTER_EXECUTION;
        var events=new java.util.ArrayList<Event>();
        events.add(new Event(running,0,drop || mode==FaultMode.DELAY_RESULT));
        events.add(new Event(terminal,0,drop));
        if (mode==FaultMode.DUPLICATE_RESULT) events.add(new Event(terminal,1,false));
        return new Execution(terminal,events);
    }
}
