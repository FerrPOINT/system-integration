package com.azhukov.integration.domain.task;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.domain.RuleViolation;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TaskTest {
    private Task task() {
        return new Task(
                UUID.randomUUID(),
                1,
                UUID.randomUUID(),
                UUID.randomUUID(),
                new TaskTitle("Название", 4),
                new TaskInput(25),
                DeliveryStatus.ACKNOWLEDGED,
                BusinessStatus.SUCCEEDED,
                OffsetDateTime.parse("2026-01-01T00:00:00Z"),
                new TaskOutcome(BusinessStatus.SUCCEEDED, OffsetDateTime.parse("2026-01-01T00:00:01Z"), null));
    }

    @Test
    void renamingCannotRewriteTheOwnerOriginalRequestOrExternalOutcome() {
        var before = task();
        var after = before.rename("Другое название", 4);
        assertEquals(new TaskTitle("Другое название", 5), after.title());
        assertEquals(new TaskTitle("Название", 4), before.title());
        assertEquals(before.id(), after.id());
        assertEquals(before.taskNumber(), after.taskNumber());
        assertEquals(before.operationId(), after.operationId());
        assertEquals(before.ownerId(), after.ownerId());
        assertSame(before.request(), after.request());
        assertSame(before.outcome(), after.outcome());
        assertEquals(before.businessStatus(), after.businessStatus());
        assertEquals(before.deliveryStatus(), after.deliveryStatus());
        assertEquals(before.createdAt(), after.createdAt());
    }

    @Test
    void changingDeliveryDoesNotRewriteTheBusinessOutcomeOrTitleVersion() {
        var initial = task();
        var before =
                new Task(
                        initial.id(),
                        1,
                        initial.operationId(),
                        initial.ownerId(),
                        initial.title(),
                        initial.request(),
                        DeliveryStatus.NEEDS_REVIEW,
                        BusinessStatus.PENDING,
                        initial.createdAt(),
                        null);
        var after = before.withDeliveryStatus(DeliveryStatus.STOPPED);
        assertEquals(DeliveryStatus.STOPPED, after.deliveryStatus());
        assertEquals(DeliveryStatus.NEEDS_REVIEW, before.deliveryStatus());
        assertSame(before.title(), after.title());
        assertSame(before.request(), after.request());
        assertSame(before.outcome(), after.outcome());
        assertEquals(before.businessStatus(), after.businessStatus());
    }

    @Test
    void immutableRequestRespectsQuantityBoundaries() {
        assertEquals(1, new TaskInput(1).quantity());
        assertEquals(1000, new TaskInput(1000).quantity());
        assertThrows(RuleViolation.class, () -> new TaskInput(0));
        assertThrows(RuleViolation.class, () -> new TaskInput(1001));
    }
}
