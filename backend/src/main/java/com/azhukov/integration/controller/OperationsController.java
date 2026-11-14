package com.azhukov.integration.controller;

import com.azhukov.integration.contract.internal.api.OperationsApi;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.mapper.ReviewApiMapper;
import com.azhukov.integration.security.AppUser;
import com.azhukov.integration.service.ReconciliationService;
import com.azhukov.integration.service.ReviewService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class OperationsController implements OperationsApi {
    private final ReviewService operations;
    private final ReconciliationService reconciliation;
    private final ReviewApiMapper mapper;

    @Override
    public ResponseEntity<Issue> getExchangeIssue(UUID id) {
        var result = operations.get(AppUser.current().actor(), id);
        return ResponseEntity.ok(mapper.issueView(result));
    }

    @Override
    public ResponseEntity<IssuePage> listExchangeIssues(Integer page, Integer size, IssueStatus status) {
        var result = operations.list(AppUser.current().actor(), page, size, mapper.status(status));
        return ResponseEntity.ok(mapper.issues(result));
    }

    @Override
    public ResponseEntity<Reconciliation> getTaskReconciliation(UUID task, UUID id) {
        var result = operations.reconciliation(AppUser.current().actor(), task, id);
        return ResponseEntity.ok(mapper.reconciliation(result));
    }

    @Override
    public ResponseEntity<Reconciliation> reconcileTask(String csrf, UUID key, UUID task) {
        var result = reconciliation.reconcile(AppUser.current().actor(), task, key);
        return ResponseEntity.ok(mapper.reconciliation(result));
    }

    @Override
    public ResponseEntity<Issue> takeExchangeIssue(String csrf, UUID key, UUID id, TakeIssueRequest input) {
        var command = mapper.take(input);
        var result = operations.take(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(mapper.issue(result));
    }

    @Override
    public ResponseEntity<Issue> retryExchange(String csrf, UUID key, UUID id, RetryRequest input) {
        var command = mapper.retry(input);
        var result = operations.retry(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(mapper.issue(result));
    }

    @Override
    public ResponseEntity<IssueResolution> resolveExchangeIssue(
            String csrf, UUID key, UUID id, ResolveIssueRequest input) {
        var command = mapper.resolve(input);
        var result = operations.resolve(AppUser.current().actor(), key, id, command);
        return ResponseEntity.ok(mapper.resolution(result));
    }
}
