package com.azhukov.integration.exchange;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.contract.internal.model.Reconciliation;
import com.azhukov.integration.tasks.OperationsTransactions;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class ReconciliationService {
    private final OperationsTransactions operations;
    private final ExchangeClient client;

    public ReconciliationService(OperationsTransactions operations,ExchangeClient client) {
        this.operations=operations; this.client=client;
    }

    public Reconciliation reconcile(AppUser user,UUID task,UUID key) {
        var before=operations.snapshot(user,task);
        // Both database transactions finish outside this network call.
        var reply=client.get(before.task().getOperationId());
        return operations.saveReconciliation(user,key,before,reply);
    }
}
