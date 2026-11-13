package com.azhukov.integration.web;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.application.review.IssueCommands;
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
    @Override public ResponseEntity<Issue> getExchangeIssue(UUID id) { return ResponseEntity.ok(ReviewViews.issue(operations.get(AppUser.current().actor(),id))); }
    @Override public ResponseEntity<IssuePage> listExchangeIssues(Integer page,IssueStatus status) { return ResponseEntity.ok(list(page,status)); }
    @Override public ResponseEntity<Reconciliation> getTaskReconciliation(UUID task,UUID id) { return ResponseEntity.ok(ReviewViews.reconciliation(operations.reconciliation(AppUser.current().actor(),task,id))); }
    @Override public ResponseEntity<Reconciliation> reconcileTask(String csrf,UUID key,UUID task) { return ResponseEntity.ok(ReviewViews.reconciliation(reconciliation.reconcile(AppUser.current().actor(),task,key))); }
    @Override public ResponseEntity<Issue> takeExchangeIssue(String csrf,UUID key,UUID id,TakeIssueRequest input) { return ResponseEntity.ok(ReviewViews.issue(operations.take(AppUser.current().actor(),key,id,new IssueCommands.Take(input.getExpectedIssueRevision())))); }
    @Override public ResponseEntity<Issue> retryExchange(String csrf,UUID key,UUID id,RetryRequest input) { return ResponseEntity.ok(ReviewViews.issue(operations.retry(AppUser.current().actor(),key,id,new IssueCommands.Retry(input.getExpectedIssueRevision(),input.getReason(),input.getReconciliationId())))); }
    @Override public ResponseEntity<IssueResolution> resolveExchangeIssue(String csrf,UUID key,UUID id,ResolveIssueRequest input) { return ResponseEntity.ok(ReviewViews.resolution(operations.resolve(AppUser.current().actor(),key,id,new IssueCommands.Resolve(input.getExpectedIssueRevision(),input.getReconciliationId(),
        com.azhukov.integration.domain.review.IssueResolution.Action.valueOf(input.getAction().name()),input.getReason())))); }

    private IssuePage list(int page,IssueStatus status) {
        var result=operations.list(AppUser.current().actor(),page,status==null ? null :
            com.azhukov.integration.domain.review.Issue.Status.valueOf(status.getValue()));
        return new IssuePage(result.items().stream().map(ReviewViews::issue).toList(),result.page(),result.hasNext(),result.totalItems(),result.totalPages());
    }
}
