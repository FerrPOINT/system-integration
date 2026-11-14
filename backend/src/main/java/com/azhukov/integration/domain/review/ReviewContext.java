package com.azhukov.integration.domain.review;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.task.DeliveryStatus;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static com.azhukov.integration.domain.review.Issue.Action.*;

/** One policy is used both for displayed actions and for locked command validation. */
public record ReviewContext(Issue issue, boolean queueFree, ExchangeState state,
                            Reconciliation reconciliation, Long reconciliationVersion) {
    public boolean fresh() {
        return state!=null && reconciliation!=null && reconciliationVersion!=null && reconciliationVersion==state.version();
    }

    public OperationSnapshot external() { return reconciliation==null ? null : reconciliation.external(); }

    public List<Issue.Action> actions(UUID operator) {
        if (issue.status()!=Issue.Status.OPEN || state==null) return List.of();
        var actions=new ArrayList<Issue.Action>();
        if (!operator.equals(issue.assignedTo())) actions.add(TAKE_OWNERSHIP);
        actions.add(RECONCILE);
        var external=fresh() ? external() : null;
        boolean protocolError=issue.kind()==Issue.Kind.PROTOCOL_ERROR;
        boolean delayed=issue.kind()==Issue.Kind.DELIVERY_DELAYED;
        boolean retryable=pausedDelivery() || (delayed && (state.task().deliveryStatus()==DeliveryStatus.UNKNOWN
            || state.task().deliveryStatus()==DeliveryStatus.RETRY_WAIT || state.task().deliveryStatus()==DeliveryStatus.QUEUED));
        if (retryable && queueFree && fresh() &&
            reconciliation.externalAvailability()!=Reconciliation.Availability.UNAVAILABLE &&
            (external==null || (sameIdentity(state,external) && external.executions()==0))) actions.add(RETRY);
        boolean reviewKind=protocolError || pausedDelivery() || issue.kind()==Issue.Kind.RESULT_CONFLICT || issue.kind()==Issue.Kind.RECONCILIATION_DIFFERENCE;
        if (reviewKind && fresh() && reconciliation.outcome()!=Reconciliation.Outcome.UNAVAILABLE) {
            actions.add(ACKNOWLEDGE_DIFFERENCE);
            var result=external==null ? null : external.result();
            if (result!=null && sameIdentity(state,external) && result.version()==2 &&
                (state.result()==null || result.version()>state.result().version())) actions.add(APPLY_EXTERNAL_RESULT);
        }
        return List.copyOf(actions);
    }

    public boolean pausedDelivery() {
        return state!=null && state.task().deliveryStatus()==DeliveryStatus.NEEDS_REVIEW &&
            (issue.kind()==Issue.Kind.PROTOCOL_ERROR || issue.kind()==Issue.Kind.DELIVERY_DELAYED);
    }

    public Issue view(UUID operator) { return issue.withActions(actions(operator)); }

    public void requireRevision(long expected) {
        if (issue.issueRevision()!=expected)
            throw new RuleViolation(RuleViolation.Code.ISSUE_REVISION_CONFLICT,"Проблема уже изменена. Обновите карточку");
    }

    public void requireFresh(UUID id) {
        if (id==null || !id.equals(issue.latestReconciliationId()) || !fresh()) throw stale();
    }

    public void requireAction(UUID operator,Issue.Action action) {
        if (!actions(operator).contains(action))
            throw new RuleViolation(RuleViolation.Code.ACTION_NOT_ALLOWED,"Действие недоступно в текущем состоянии");
    }

    public static boolean matches(ExchangeState state,OperationSnapshot external) {
        if (external==null) return state.task().deliveryStatus()!=DeliveryStatus.ACKNOWLEDGED && state.result()==null;
        return sameIdentity(state,external) && state.task().deliveryStatus()==DeliveryStatus.ACKNOWLEDGED &&
            Objects.equals(state.result(),external.result());
    }

    private static boolean sameIdentity(ExchangeState state,OperationSnapshot external) {
        return state.identity().equals(external.identity());
    }

    public static RuleViolation stale() {
        return new RuleViolation(RuleViolation.Code.SNAPSHOT_STALE,"Сверка устарела. Выполните новую сверку");
    }
}
