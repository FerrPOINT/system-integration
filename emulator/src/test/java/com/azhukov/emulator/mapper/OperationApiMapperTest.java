package com.azhukov.emulator.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.emulator.domain.*;
import com.azhukov.integration.contract.external.model.OperationInput;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class OperationApiMapperTest {
    @Test
    void generatedSpringMapperKeepsAcknowledgementStateEventsAndOptionalResult() {
        try (var context = new AnnotationConfigApplicationContext("com.azhukov.emulator.mapper")) {
            var mapper = context.getBean(OperationApiMapper.class);
            var id = UUID.randomUUID();
            var time = OffsetDateTime.parse("2026-01-02T03:04:05Z");
            var request = mapper.request(new OperationInput("REQ-000001", 125));
            assertEquals(new OperationRequest("REQ-000001", 125), request);
            var pending = new Operation(id, request, time, 0, null);
            var acknowledgement = mapper.acknowledgement(pending);
            assertEquals(id, acknowledgement.getOperationId());
            assertEquals(time, acknowledgement.getAcceptedAt());
            assertEquals("REQ-000001", acknowledgement.getRequest().getReference());
            assertNull(mapper.operation(pending).getResult());
            assertEquals(0, mapper.operation(pending).getExecutions().getValue());
            for (var status : OperationResult.Status.values()) {
                boolean running = status == OperationResult.Status.RUNNING;
                var result =
                        new OperationResult(
                                id,
                                request,
                                running ? 1 : 2,
                                status,
                                running ? null : time,
                                status == OperationResult.Status.REJECTED ? "QUANTITY_LIMIT_EXCEEDED" : null);
                var event = mapper.events(List.of(new ResultEvent(5, result))).getFirst();
                assertEquals(5L, event.getCursor());
                assertEquals(id, event.getResult().getOperationId());
                assertEquals(125, event.getResult().getRequest().getQuantity());
                assertEquals(status.name(), event.getResult().getStatus().name());
                assertEquals(result.version(), event.getResult().getVersion().getValue());
                assertEquals(result.completedAt(), event.getResult().getCompletedAt());
                assertEquals(result.rejectionCode(), event.getResult().getRejectionCode());
                if (!running)
                    assertEquals(
                            1,
                            mapper.operation(new Operation(id, request, time, 1, result)).getExecutions().getValue());
            }
            assertNull(mapper.result(null));
            assertThrows(IllegalArgumentException.class, () -> mapper.version(3));
            assertThrows(IllegalArgumentException.class, () -> mapper.executions(2));
        }
    }
}
