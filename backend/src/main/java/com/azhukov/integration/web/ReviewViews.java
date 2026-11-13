package com.azhukov.integration.web;

import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.Evidence;

final class ReviewViews {
    private ReviewViews() {}

    static Issue issue(com.azhukov.integration.domain.review.Issue value) {
        return new Issue(value.issueId(),value.issueRevision(),Issue.KindEnum.fromValue(value.kind().name()),
            IssueStatus.fromValue(value.status().name()),value.openedAt(),value.summary(),
            value.allowedActions().stream().map(action -> Issue.AllowedActionsEnum.fromValue(action.name())).toList())
            .taskId(value.taskId()).operationId(value.operationId()).assignedTo(value.assignedTo())
            .nextAttemptAt(value.nextAttemptAt()).latestReconciliationId(value.latestReconciliationId())
            .evidence(evidence(value.evidence())).resolution(resolution(value.resolution()));
    }

    static IssueResolution resolution(com.azhukov.integration.domain.review.IssueResolution value) {
        if (value==null) return null;
        return new IssueResolution(value.issueId(),value.reconciliationId(),ResolutionAction.fromValue(value.action().name()),
            value.reason(),value.decidedBy(),value.decidedAt());
    }

    static Reconciliation reconciliation(com.azhukov.integration.domain.review.Reconciliation value) {
        return new Reconciliation(value.reconciliationId(),value.taskId(),value.operationId(),value.checkedAt(),value.checkedBy(),
            Reconciliation.OutcomeEnum.fromValue(value.outcome().name()),local(value.local()),
            Reconciliation.ExternalAvailabilityEnum.fromValue(value.externalAvailability().name()))
            .external(value.external()).issueId(value.issueId());
    }

    private static ExchangeEvidence evidence(Evidence value) {
        if (value==null) return null;
        return new ExchangeEvidence(value.reason()).cursor(value.cursor()).local(local(value.local())).received(received(value.received()));
    }

    private static LocalSnapshot local(com.azhukov.integration.domain.exchange.LocalSnapshot value) {
        if (value==null) return null;
        var result=new LocalSnapshot(new Request(value.request().reference(),value.request().quantity()),
            DeliveryStatus.fromValue(value.deliveryStatus().name()),BusinessStatus.fromValue(value.businessStatus().name()))
            .resultVersion(value.resultVersion()==null ? null : LocalSnapshot.ResultVersionEnum.fromValue(value.resultVersion()));
        if (value.result()!=null) {
            var outcome=value.result();
            result.result(new TaskResult(TaskResult.StatusEnum.fromValue(outcome.status().name()),outcome.completedAt())
                .rejectionCode(outcome.rejectionCode()==null ? null : TaskResult.RejectionCodeEnum.fromValue(outcome.rejectionCode())));
        }
        return result;
    }

    private static ExchangeEvidenceReceived received(OperationResult value) {
        if (value==null) return null;
        return new ExchangeEvidenceReceived(value.operationId(),new ExchangeEvidenceReceivedRequest(value.request().reference(),value.request().quantity()),
            ExchangeEvidenceReceived.VersionEnum.fromValue(value.version()),ExchangeEvidenceReceived.StatusEnum.fromValue(value.status().name()))
            .completedAt(value.completedAt()).rejectionCode(value.rejectionCode());
    }
}
