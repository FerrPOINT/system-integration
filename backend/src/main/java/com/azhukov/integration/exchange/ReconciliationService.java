package com.azhukov.integration.exchange;

import com.azhukov.integration.application.Actor;
import com.azhukov.integration.domain.review.Reconciliation;
import com.azhukov.integration.application.port.OperationLookup;
import com.azhukov.integration.tasks.OperationsTransactions;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class ReconciliationService {
    private final OperationsTransactions operations;
    private final OperationLookup client;

    public ReconciliationService(OperationsTransactions operations,OperationLookup client) {
        this.operations=operations; this.client=client;
    }

    public Reconciliation reconcile(Actor user,UUID task,UUID key) {
        var before=operations.snapshot(user,task);
        // Both database transactions finish outside this network call.
        var reply=client.lookup(before.task().operationId());
        return operations.saveReconciliation(user,key,before,reply);
    }
}
