package com.azhukov.integration.web;

import com.azhukov.integration.auth.AppUser;
import com.azhukov.integration.application.review.IssueCommands;
import com.azhukov.integration.application.ReconciliationService;
import com.azhukov.integration.contract.internal.api.OperationsApi;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.application.ReviewService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
public class OperationsController implements OperationsApi {
    private final ReviewService operations;
    private final ReconciliationService reconciliation;
    public OperationsController(ReviewService operations,ReconciliationService reconciliation) {
        this.operations=operations; this.reconciliation=reconciliation;
    }
    @Override
    public ResponseEntity<Issue> getExchangeIssue(UUID id) {
        var result = operations.get(AppUser.current().actor(), id);
        return ResponseEntity.ok(ReviewViews.issue(result));
    }

    @Override
    public ResponseEntity<IssuePage> listExchangeIssues(Integer page, IssueStatus status) {
        var filter = status == null ? null :
            com.azhukov.integration.domain.review.Issue.Status.valueOf(status.getValue());
        var result = operations.list(AppUser.current().actor(), page, filter);
        return ResponseEntity.ok(new IssuePage(
            result.items().stream().map(ReviewViews::issue).toList(),
            result.page(), result.hasNext(), result.totalItems(), result.totalPages()));
    }

    @Override
    public ResponseEntity<Reconciliation> getTaskReconciliation(UUID task, UUID id) {
        var result = operations.reconciliation(AppUser.current().actor(), task, id);
        return ResponseEntity.ok(ReviewViews.reconciliation(result));
    }

    @Override
    public ResponseEntity<Reconciliation> reconcileTask(String csrf, UUID key, UUID task) {
        var result = reconciliation.reconcile(AppUser.current().actor(), task, key);
        return ResponseEntity.ok(ReviewViews.reconciliation(result));
    }

    @Override
    public ResponseEntity<Issue> takeExchangeIssue(String csrf, UUID key, UUID id, TakeIssueRequest input) {
        var command = new IssueCommands.Take(input.getExpectedIssueRevision());
        var result = operations.take(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(ReviewViews.issue(result));
    }

    @Override
    public ResponseEntity<Issue> retryExchange(String csrf, UUID key, UUID id, RetryRequest input) {
        var command = new IssueCommands.Retry(
            input.getExpectedIssueRevision(), input.getReason(), input.getReconciliationId());
        var result = operations.retry(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(ReviewViews.issue(result));
    }

    @Override
    public ResponseEntity<IssueResolution> resolveExchangeIssue(String csrf, UUID key, UUID id, ResolveIssueRequest input) {
        var action = com.azhukov.integration.domain.review.IssueResolution.Action.valueOf(input.getAction().name());
        var command = new IssueCommands.Resolve(
            input.getExpectedIssueRevision(), input.getReconciliationId(), action, input.getReason());
        var result = operations.resolve(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(ReviewViews.resolution(result));
    }
}
