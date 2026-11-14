package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;
import org.junit.jupiter.api.Test;
import java.time.OffsetDateTime;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class TaskTest {
    private Task task() {
        return new Task(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),new TaskTitle("Название",4),
            new TaskInput("REQ-123456",25),DeliveryStatus.ACKNOWLEDGED,BusinessStatus.SUCCEEDED,
            OffsetDateTime.parse("2026-01-01T00:00:00Z"),
            new TaskOutcome(BusinessStatus.SUCCEEDED,OffsetDateTime.parse("2026-01-01T00:00:01Z"),null));
    }

    @Test
    void renamingCannotRewriteTheOwnerOriginalRequestOrExternalOutcome() {
        var before = task();
        var after = before.rename("Другое название",4);
        assertEquals(new TaskTitle("Другое название",5),after.title());
        assertEquals(new TaskTitle("Название",4),before.title());
        assertEquals(before.id(),after.id());
        assertEquals(before.operationId(),after.operationId());
        assertEquals(before.ownerId(),after.ownerId());
        assertSame(before.request(),after.request());
        assertSame(before.outcome(),after.outcome());
        assertEquals(before.businessStatus(),after.businessStatus());
        assertEquals(before.deliveryStatus(),after.deliveryStatus());
        assertEquals(before.createdAt(),after.createdAt());
    }

    @Test
    void changingDeliveryDoesNotRewriteTheBusinessOutcomeOrTitleVersion() {
        var initial = task();
        var before = new Task(initial.id(),initial.operationId(),initial.ownerId(),initial.title(),
            initial.request(),DeliveryStatus.NEEDS_REVIEW,BusinessStatus.PENDING,initial.createdAt(),null);
        var after = before.withDeliveryStatus(DeliveryStatus.STOPPED);
        assertEquals(DeliveryStatus.STOPPED,after.deliveryStatus());
        assertEquals(DeliveryStatus.NEEDS_REVIEW,before.deliveryStatus());
        assertSame(before.title(),after.title());
        assertSame(before.request(),after.request());
        assertSame(before.outcome(),after.outcome());
        assertEquals(before.businessStatus(),after.businessStatus());
    }

    @Test
    void immutableRequestRespectsReferenceAndQuantityBoundaries() {
        assertEquals(1,new TaskInput("REQ-000001",1).quantity());
        assertEquals(1000,new TaskInput("REQ-999999",1000).quantity());
        for (var invalid : new TaskInputCase[]{
            new TaskInputCase(null,1),new TaskInputCase("REQ-00001",1),
            new TaskInputCase("REQ-000001 ",1),new TaskInputCase("REQ-000001",0),
            new TaskInputCase("REQ-000001",1001)}) {
            assertThrows(RuleViolation.class,() -> new TaskInput(invalid.reference(),invalid.quantity()));
        }
    }

    private record TaskInputCase(String reference,int quantity) {}
}
