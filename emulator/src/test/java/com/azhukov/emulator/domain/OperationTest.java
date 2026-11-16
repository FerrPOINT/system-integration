package com.azhukov.emulator.domain;

import static org.junit.jupiter.api.Assertions.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class OperationTest {
    private final UUID id = UUID.randomUUID();
    private final OffsetDateTime at = OffsetDateTime.parse("2026-11-12T00:00:00Z");

    private Operation pending(int quantity) {
        return new Operation(id, new OperationRequest("REQ-000001", quantity), at, 0, null);
    }

    @Test
    void resultThresholdAndImmutableInputAreOwnedByTheOperation() {
        var succeeded = pending(100).execute(FaultMode.NONE, at.plusSeconds(1));
        assertEquals(OperationResult.Status.SUCCEEDED, succeeded.result().status());
        assertNull(succeeded.result().rejectionCode());
        var rejected = pending(101).execute(FaultMode.NONE, at.plusSeconds(1));
        assertEquals(OperationResult.Status.REJECTED, rejected.result().status());
        assertEquals("QUANTITY_LIMIT_EXCEEDED", rejected.result().rejectionCode());
        var completed = new Operation(id, rejected.result().request(), at, 1, rejected.result());
        completed.requireRequest(new OperationRequest("REQ-000001", 101));
        assertThrows(IllegalStateException.class, () -> completed.execute(FaultMode.NONE, at));
        assertEquals(
                RuleViolation.Code.OPERATION_CONFLICT,
                assertThrows(
                                RuleViolation.class,
                                () -> completed.requireRequest(new OperationRequest("REQ-000002", 101)))
                        .code());
        assertEquals(
                RuleViolation.Code.OPERATION_CONFLICT,
                assertThrows(
                                RuleViolation.class,
                                () -> completed.requireRequest(new OperationRequest("REQ-000001", 100)))
                        .code());
    }

    @Test
    void faultModesChangeEventVisibilityAndCopiesWithoutChangingTheTerminalResult() {
        var ordinary = pending(25).execute(FaultMode.NONE, at);
        assertEquals(List.of(1, 2), ordinary.events().stream().map(e -> e.result().version()).toList());
        assertTrue(ordinary.events().stream().noneMatch(Operation.Event::held));
        var dropped = pending(25).execute(FaultMode.DROP_RESPONSE_AFTER_EXECUTION, at);
        assertTrue(dropped.events().stream().allMatch(Operation.Event::held));
        assertEquals(ordinary.result(), dropped.result());
        var delayed = pending(25).execute(FaultMode.DELAY_RESULT, at);
        assertTrue(delayed.events().get(0).held());
        assertFalse(delayed.events().get(1).held());
        var duplicate = pending(25).execute(FaultMode.DUPLICATE_RESULT, at);
        assertEquals(3, duplicate.events().size());
        assertEquals(duplicate.events().get(1).result(), duplicate.events().get(2).result());
        assertEquals(List.of(0, 0, 1), duplicate.events().stream().map(Operation.Event::copy).toList());
    }

    @Test
    void boundFaultIsNotConsumedByAnotherOperationAndCannotBeReconfigured() {
        var bound = new Fault(FaultMode.DUPLICATE_RESULT, id);
        assertEquals(FaultMode.NONE, bound.forNextAcceptance());
        assertFalse(bound.changeTo(FaultMode.DUPLICATE_RESULT));
        assertEquals(
                RuleViolation.Code.FAULT_ALREADY_BOUND,
                assertThrows(RuleViolation.class, () -> bound.changeTo(FaultMode.DELAY_RESULT)).code());
        assertTrue(new Fault(FaultMode.DUPLICATE_RESULT, null).changeTo(FaultMode.DELAY_RESULT));
        assertEquals(
                RuleViolation.Code.UNAVAILABLE,
                assertThrows(RuleViolation.class, () -> new Fault(FaultMode.UNAVAILABLE, null).forNextAcceptance())
                        .code());
    }
}
