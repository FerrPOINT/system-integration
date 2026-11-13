package com.azhukov.integration.application;

import com.azhukov.integration.domain.review.Reconciliation;
import com.azhukov.integration.application.port.ExternalExchange;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class ReconciliationService {
    private final ReviewService operations;
    private final ExternalExchange client;

    public ReconciliationService(ReviewService operations,ExternalExchange client) {
        this.operations=operations; this.client=client;
    }

    public Reconciliation reconcile(Actor user,UUID task,UUID key) {
        var before=operations.snapshot(user,task);
        // Both database transactions finish outside this network call.
        var reply=client.lookup(before.task().operationId());
        return operations.saveReconciliation(user,key,before,reply);
    }
}
