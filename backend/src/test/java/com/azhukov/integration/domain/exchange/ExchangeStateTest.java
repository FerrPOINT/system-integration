package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.*;
import org.junit.jupiter.api.Test;
import java.time.OffsetDateTime;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static com.azhukov.integration.domain.exchange.ExchangeState.IncomingDecision.*;

class ExchangeStateTest {
    private final UUID operation = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private final TaskInput input = new TaskInput("REQ-123456",25);
    private final OffsetDateTime at = OffsetDateTime.parse("2026-01-01T00:00:00Z");

    private OperationResult running() { return new OperationResult(operation,input,1,BusinessStatus.RUNNING,null,null); }
    private OperationResult terminal() { return new OperationResult(operation,input,2,BusinessStatus.SUCCEEDED,at,null); }
    private ExchangeState state(DeliveryStatus delivery,OperationResult result) {
        var business = result == null ? BusinessStatus.PENDING : result.status();
        var outcome = result != null && business.isTerminal() ? new TaskOutcome(business,result.completedAt(),result.rejectionCode()) : null;
        return new ExchangeState(new Task(UUID.randomUUID(),operation,UUID.randomUUID(),new TaskTitle("Название",4),
            input,delivery,business,at,outcome),7,result);
    }

    @Test
    void anUnrelatedImmutableRequestNeverBecomesADuplicateOrAnApplication() {
        var changed = new OperationResult(operation,new TaskInput("REQ-123456",26),2,BusinessStatus.SUCCEEDED,at,null);
        for (var delivery : DeliveryStatus.values())
            assertEquals(REQUEST_MISMATCH,state(delivery,terminal()).disposition(changed));
        var otherOperation = new OperationResult(UUID.randomUUID(),input,2,BusinessStatus.SUCCEEDED,at,null);
        assertEquals(REQUEST_MISMATCH,state(DeliveryStatus.QUEUED,null).disposition(otherOperation));
    }

    @Test
    void duplicateAndOlderPrecedeReviewOrStopFlags() {
        for (var delivery : DeliveryStatus.values()) {
            var current = state(delivery,terminal());
            assertEquals(DUPLICATE,current.disposition(terminal()));
            assertEquals(OLDER,current.disposition(running()));
        }
    }

    @Test
    void pausedAndStoppedKeepNewSnapshotsForAnOperator() {
        assertEquals(OBSERVE,state(DeliveryStatus.NEEDS_REVIEW,null).disposition(terminal()));
        assertEquals(STOPPED,state(DeliveryStatus.STOPPED,null).disposition(terminal()));
        var different = new OperationResult(operation,input,2,BusinessStatus.SUCCEEDED,at.plusNanos(1),null);
        assertEquals(OBSERVE,state(DeliveryStatus.NEEDS_REVIEW,terminal()).disposition(different));
        assertEquals(STOPPED,state(DeliveryStatus.STOPPED,terminal()).disposition(different));
    }

    @Test
    void sameVersionConflictAndNewerVersionAreDifferentOutcomes() {
        var different = new OperationResult(operation,input,2,BusinessStatus.REJECTED,at,"QUANTITY_LIMIT_EXCEEDED");
        assertEquals(CONFLICT,state(DeliveryStatus.ACKNOWLEDGED,terminal()).disposition(different));
        assertEquals(APPLY,state(DeliveryStatus.ACKNOWLEDGED,running()).disposition(terminal()));
        assertEquals(APPLY,state(DeliveryStatus.QUEUED,null).disposition(running()));
        var renamed = state(DeliveryStatus.QUEUED,null);
        var sameIdentity = new ExchangeState(renamed.task().rename("Совсем другое название",4),renamed.version(),renamed.result());
        assertEquals(APPLY,sameIdentity.disposition(running()));
    }

    @Test
    void aDeliveryChangeAdvancesOnlyTheExchangeVersion() {
        var original = state(DeliveryStatus.QUEUED,null);
        var changed = original.withDeliveryStatus(DeliveryStatus.UNKNOWN);
        assertEquals(8,changed.version());
        assertEquals(7,original.version());
        assertSame(original.task().title(),changed.task().title());
        assertSame(changed,changed.withDeliveryStatus(DeliveryStatus.UNKNOWN));
    }

    @Test
    void applyingResultsAdvancesExchangeStateAndPreservesTaskIdentityAndTitle() {
        var original=state(DeliveryStatus.QUEUED,null);
        var running=original.withAppliedResult(running());
        var finished=running.withAppliedResult(terminal());
        assertEquals(8,running.version());
        assertEquals(9,finished.version());
        assertEquals(DeliveryStatus.ACKNOWLEDGED,finished.task().deliveryStatus());
        assertEquals(BusinessStatus.RUNNING,running.task().businessStatus());
        assertNull(running.task().outcome());
        assertEquals(new TaskOutcome(BusinessStatus.SUCCEEDED,at,null),finished.task().outcome());
        assertSame(original.task().title(),finished.task().title());
        assertEquals(original.task().id(),finished.task().id());
        assertEquals(original.task().ownerId(),finished.task().ownerId());
        assertEquals(original.task().request(),finished.task().request());
        assertEquals(original.task().createdAt(),finished.task().createdAt());
        assertNull(original.result());
        var rejected=new OperationResult(operation,input,2,BusinessStatus.REJECTED,at,"QUANTITY_LIMIT_EXCEEDED");
        assertEquals(new TaskOutcome(BusinessStatus.REJECTED,at,"QUANTITY_LIMIT_EXCEEDED"),
            running.withAppliedResult(rejected).task().outcome());
        var wrong=new OperationResult(UUID.randomUUID(),input,2,BusinessStatus.SUCCEEDED,at,null);
        assertThrows(IllegalArgumentException.class,() -> original.withAppliedResult(wrong));
    }

    @Test
    void invalidPersistedVersionsAreExplicitFailures() {
        var task = state(DeliveryStatus.QUEUED,null).task();
        assertThrows(IllegalArgumentException.class,() -> new ExchangeState(task,0,null));
        assertThrows(IllegalArgumentException.class,() -> new ExchangeState(task,9007199254740992L,null));
    }
}
