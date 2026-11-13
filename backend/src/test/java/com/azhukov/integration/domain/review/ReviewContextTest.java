package com.azhukov.integration.domain.review;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.exchange.*;
import com.azhukov.integration.domain.task.*;
import org.junit.jupiter.api.Test;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import static com.azhukov.integration.domain.review.Issue.Action.*;
import static org.junit.jupiter.api.Assertions.*;

class ReviewContextTest {
    private final UUID taskId=UUID.randomUUID(),operationId=UUID.randomUUID(),operator=UUID.randomUUID(),snapshotId=UUID.randomUUID();
    private final OffsetDateTime time=OffsetDateTime.parse("2026-11-12T00:00:00Z");
    private final TaskInput input=new TaskInput("REQ-000001",25);

    private ExchangeState state(DeliveryStatus delivery,OperationResult result,long revision) {
        var outcome=result==null || !result.status().isTerminal() ? null :
            new TaskOutcome(result.status(),result.completedAt(),result.rejectionCode());
        return new ExchangeState(new Task(taskId,operationId,UUID.randomUUID(),new TaskTitle("Задание",7),input,
            delivery,result==null ? BusinessStatus.PENDING : result.status(),time,outcome),revision,result);
    }
    private Issue issue(Issue.Kind kind,Issue.Status status,UUID owner,UUID task) {
        return new Issue(UUID.randomUUID(),task,operationId,3,kind,status,time,"Проверка",owner,
            new Evidence("Причина",null,null,null),List.of(),null,snapshotId,null);
    }
    private OperationSnapshot external(boolean terminal,TaskInput request) {
        var result=terminal ? new OperationResult(operationId,request,2,BusinessStatus.SUCCEEDED,time,null) : null;
        return new OperationSnapshot(operationId,request,time,terminal ? 1 : 0,result);
    }
    private ReviewContext context(Issue issue,ExchangeState state,boolean queueFree,
                                  OperationSnapshot external,Reconciliation.Availability availability,long savedVersion) {
        var saved=new Reconciliation(snapshotId,taskId,operationId,time,operator,
            availability==Reconciliation.Availability.UNAVAILABLE ? Reconciliation.Outcome.UNAVAILABLE : Reconciliation.Outcome.DIFFERENCE,
            LocalSnapshot.of(state),availability,external,issue.issueId());
        return new ReviewContext(issue,queueFree,state,saved,savedVersion);
    }

    @Test
    void closedAndFeedIssuesHaveNoActionsEvenWithCachedAllowedActions() {
        var state=state(DeliveryStatus.UNKNOWN,null,10);
        var closed=issue(Issue.Kind.DELIVERY_DELAYED,Issue.Status.RESOLVED,null,taskId).withActions(List.of(RETRY));
        assertTrue(context(closed,state,true,null,Reconciliation.Availability.NOT_FOUND,10).actions(operator).isEmpty());
        var feed=issue(Issue.Kind.RESULT_CONFLICT,Issue.Status.OPEN,null,null).withActions(List.of(APPLY_EXTERNAL_RESULT));
        assertTrue(new ReviewContext(feed,false,null,null,null).actions(operator).isEmpty());
    }

    @Test
    void delayedDeliveryRequiresFreshEvidenceAndOwnershipControlsOnlyTake() {
        var state=state(DeliveryStatus.RETRY_WAIT,null,10);
        var issue=issue(Issue.Kind.DELIVERY_DELAYED,Issue.Status.OPEN,operator,taskId);
        assertEquals(List.of(RECONCILE),context(issue,state,true,null,Reconciliation.Availability.UNAVAILABLE,10).actions(operator));
        assertTrue(context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,10).actions(operator).contains(RETRY));
        assertEquals(List.of(TAKE_OWNERSHIP,RECONCILE),context(issue,state,false,null,Reconciliation.Availability.UNAVAILABLE,10).actions(UUID.randomUUID()));
    }

    @Test
    void protocolRetryRequiresFreshKnownNonExecutedMatchingEvidence() {
        var state=state(DeliveryStatus.NEEDS_REVIEW,null,10);
        var issue=issue(Issue.Kind.PROTOCOL_ERROR,Issue.Status.OPEN,null,taskId);
        var missing=context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,10);
        assertEquals(List.of(TAKE_OWNERSHIP,RECONCILE,RETRY,ACKNOWLEDGE_DIFFERENCE),missing.actions(operator));
        assertTrue(context(issue,state,true,external(false,input),Reconciliation.Availability.PRESENT,10).actions(operator).contains(RETRY));
        assertFalse(context(issue,state,true,external(false,new TaskInput("REQ-000002",25)),Reconciliation.Availability.PRESENT,10).actions(operator).contains(RETRY));
        assertFalse(context(issue,state,false,null,Reconciliation.Availability.NOT_FOUND,10).actions(operator).contains(RETRY));
        assertFalse(context(issue,state,true,null,Reconciliation.Availability.UNAVAILABLE,10).actions(operator).contains(RETRY));
        assertFalse(context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,9).actions(operator).contains(RETRY));
        assertFalse(context(issue,state(DeliveryStatus.STOPPED,null,10),true,null,Reconciliation.Availability.NOT_FOUND,10).actions(operator).contains(RETRY));
    }

    @Test
    void applyingExternalResultRequiresStrictlyNewerTerminalResultOfTheSameIdentity() {
        var state=state(DeliveryStatus.NEEDS_REVIEW,null,10);
        var issue=issue(Issue.Kind.RESULT_CONFLICT,Issue.Status.OPEN,operator,taskId);
        assertEquals(List.of(RECONCILE,ACKNOWLEDGE_DIFFERENCE,APPLY_EXTERNAL_RESULT),
            context(issue,state,true,external(true,input),Reconciliation.Availability.PRESENT,10).actions(operator));
        assertEquals(List.of(RECONCILE,ACKNOWLEDGE_DIFFERENCE),
            context(issue,state,true,external(true,new TaskInput("REQ-000001",26)),Reconciliation.Availability.PRESENT,10).actions(operator));
        assertFalse(context(issue,state,true,external(false,input),Reconciliation.Availability.PRESENT,10).actions(operator).contains(APPLY_EXTERNAL_RESULT));
        var completed=state(DeliveryStatus.ACKNOWLEDGED,external(true,input).result(),10);
        assertFalse(context(issue,completed,false,external(true,input),Reconciliation.Availability.PRESENT,10).actions(operator).contains(APPLY_EXTERNAL_RESULT));
        assertEquals(List.of(RECONCILE),context(issue,state,true,external(true,input),Reconciliation.Availability.PRESENT,9).actions(operator));
    }

    @Test
    void exhaustedDeliveryRequiresFreshEvidenceAndCanApplyACompletedExternalResult() {
        var state=state(DeliveryStatus.NEEDS_REVIEW,null,10);
        var issue=issue(Issue.Kind.DELIVERY_DELAYED,Issue.Status.OPEN,operator,taskId);
        assertFalse(context(issue,state,true,null,Reconciliation.Availability.UNAVAILABLE,10).actions(operator).contains(RETRY));
        assertFalse(context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,9).actions(operator).contains(RETRY));
        assertTrue(context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,10).actions(operator).contains(RETRY));
        var completed=context(issue,state,true,external(true,input),Reconciliation.Availability.PRESENT,10);
        assertFalse(completed.actions(operator).contains(RETRY));
        assertTrue(completed.actions(operator).contains(APPLY_EXTERNAL_RESULT));
        assertTrue(completed.actions(operator).contains(ACKNOWLEDGE_DIFFERENCE));
    }

    @Test
    void staleSnapshotAndWrongIssueRevisionAreDistinctConflicts() {
        var state=state(DeliveryStatus.NEEDS_REVIEW,null,10);
        var issue=issue(Issue.Kind.PROTOCOL_ERROR,Issue.Status.OPEN,operator,taskId);
        var context=context(issue,state,true,null,Reconciliation.Availability.NOT_FOUND,10);
        context.requireFresh(snapshotId); context.requireRevision(3);
        assertEquals(RuleViolation.Code.ISSUE_REVISION_CONFLICT,
            assertThrows(RuleViolation.class,() -> context.requireRevision(2)).code());
        assertEquals(RuleViolation.Code.SNAPSHOT_STALE,
            assertThrows(RuleViolation.class,() -> context.requireFresh(UUID.randomUUID())).code());
        assertEquals(RuleViolation.Code.SNAPSHOT_STALE,
            assertThrows(RuleViolation.class,() -> context.requireFresh(null)).code());
        assertEquals(RuleViolation.Code.ACTION_NOT_ALLOWED,
            assertThrows(RuleViolation.class,() -> context.requireAction(operator,APPLY_EXTERNAL_RESULT)).code());
    }

    @Test
    void comparisonDependsOnExchangeIdentityDeliveryAndResultNotTitleOrAcceptedTime() {
        assertTrue(ReviewContext.matches(state(DeliveryStatus.UNKNOWN,null,10),null));
        assertFalse(ReviewContext.matches(state(DeliveryStatus.ACKNOWLEDGED,null,10),null));
        var external=external(true,input);
        var local=state(DeliveryStatus.ACKNOWLEDGED,external.result(),10);
        assertTrue(ReviewContext.matches(local,external));
        var renamed=new ExchangeState(local.task().rename("Другое имя",7),10,external.result());
        assertTrue(ReviewContext.matches(renamed,new OperationSnapshot(operationId,input,time.plusHours(1),1,external.result())));
        assertFalse(ReviewContext.matches(local,new OperationSnapshot(operationId,new TaskInput("REQ-000002",25),time,0,null)));
        assertFalse(ReviewContext.matches(state(DeliveryStatus.UNKNOWN,external.result(),10),external));
    }
}
