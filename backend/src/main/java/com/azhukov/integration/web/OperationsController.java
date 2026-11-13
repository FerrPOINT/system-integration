package com.azhukov.integration.web;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.exchange.ReconciliationService;
import com.azhukov.integration.contract.internal.api.OperationsApi;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.tasks.OperationsTransactions;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
public class OperationsController implements OperationsApi {
    private final OperationsTransactions operations;
    private final ReconciliationService reconciliation;
    public OperationsController(OperationsTransactions operations,ReconciliationService reconciliation) {
        this.operations=operations; this.reconciliation=reconciliation;
    }
    @Override public ResponseEntity<Issue> getExchangeIssue(UUID id) { return ResponseEntity.ok(operations.get(AppUser.current().actor(),id)); }
    @Override public ResponseEntity<IssuePage> listExchangeIssues(Integer page,IssueStatus status) { return ResponseEntity.ok(operations.list(AppUser.current().actor(),page,status)); }
    @Override public ResponseEntity<Reconciliation> getTaskReconciliation(UUID task,UUID id) { return ResponseEntity.ok(operations.reconciliation(AppUser.current().actor(),task,id)); }
    @Override public ResponseEntity<Reconciliation> reconcileTask(String csrf,UUID key,UUID task) { return ResponseEntity.ok(reconciliation.reconcile(AppUser.current().actor(),task,key)); }
    @Override public ResponseEntity<Issue> takeExchangeIssue(String csrf,UUID key,UUID id,TakeIssueRequest input) { return ResponseEntity.ok(operations.take(AppUser.current().actor(),key,id,input)); }
    @Override public ResponseEntity<Issue> retryExchange(String csrf,UUID key,UUID id,RetryRequest input) { return ResponseEntity.ok(operations.retry(AppUser.current().actor(),key,id,input)); }
    @Override public ResponseEntity<IssueResolution> resolveExchangeIssue(String csrf,UUID key,UUID id,ResolveIssueRequest input) { return ResponseEntity.ok(operations.resolve(AppUser.current().actor(),key,id,input)); }
}
