package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.review.Reconciliation;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class ReconciliationService {
    private final ReviewService operations;
    private final ExternalExchangeClient client;

    public Reconciliation reconcile(Actor user,UUID task,UUID key) {
        var start=operations.prepareReconciliation(user,task,key);
        if (start.replay()!=null) return start.replay();
        var before=start.before();
        // Both database transactions finish outside this network call.
        var reply=client.lookup(before.task().operationId());
        return operations.saveReconciliation(user,key,before,reply);
    }
}
