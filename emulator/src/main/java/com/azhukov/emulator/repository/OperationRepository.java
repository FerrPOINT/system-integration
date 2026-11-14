package com.azhukov.emulator.repository;

import com.azhukov.emulator.domain.*;
import java.util.List;
import java.util.UUID;

public interface OperationRepository {
    Operation get(UUID id);
    List<Operation> lockNext();
    List<ResultEvent> events(long after,int limit);
    FaultMode fault(UUID id);
    void event(OperationResult result,int copy,boolean held);
    void lockOperation(UUID id);
    boolean exists(UUID id);
    Fault lockFault(String reference);
    void insert(UUID id,OperationRequest input);
    void bindFault(String reference,UUID id);
    void complete(OperationResult result);
    int publish(int limit);
    void lockFaultConfiguration(String reference);
    void configure(String reference,FaultMode mode);
    void releaseEvents(UUID operation);
    void clearFault(String reference);
}
