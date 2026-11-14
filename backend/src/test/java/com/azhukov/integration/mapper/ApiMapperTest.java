package com.azhukov.integration.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskOutcome;
import com.azhukov.integration.domain.task.TaskTitle;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.HistoryEntry;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class ApiMapperTest {
    private final UUID id = UUID.fromString("00000000-0000-4000-8000-000000000001");
    private final UUID operation = UUID.fromString("00000000-0000-4000-8000-000000000002");
    private final UUID owner = UUID.fromString("00000000-0000-4000-8000-000000000003");
    private final OffsetDateTime time = OffsetDateTime.parse("2026-01-02T03:04:05Z");
    private final TaskInput request = new TaskInput("REQ-000001", 125);

    private AnnotationConfigApplicationContext context() {
        return new AnnotationConfigApplicationContext("com.azhukov.integration.mapper");
    }

    @Test
    void generatedSpringMappersKeepTaskFieldsAndOptionalTerminalOutcome() {
        try (var context = context()) {
            var mapper = context.getBean(TaskApiMapper.class);
            for (var status : com.azhukov.integration.domain.task.BusinessStatus.values()) {
                var outcome =
                        status.isTerminal()
                                ? new TaskOutcome(
                                        status,
                                        time,
                                        status == com.azhukov.integration.domain.task.BusinessStatus.REJECTED
                                                ? "QUANTITY_LIMIT_EXCEEDED"
                                                : null)
                                : null;
                var task =
                        new com.azhukov.integration.domain.task.Task(
                                id,
                                operation,
                                owner,
                                new TaskTitle("Задание", 7),
                                request,
                                com.azhukov.integration.domain.task.DeliveryStatus.ACKNOWLEDGED,
                                status,
                                time,
                                outcome);
                var value = mapper.task(task);
                assertAll(
                        () -> assertEquals(id, value.getTaskId()),
                        () -> assertEquals(operation, value.getOperationId()),
                        () -> assertEquals(owner, value.getOwnerId()),
                        () -> assertEquals("Задание", value.getTitle()),
                        () -> assertEquals(7L, value.getTitleRevision()),
                        () -> assertEquals(time, value.getCreatedAt()),
                        () -> assertEquals("REQ-000001", value.getRequest().getReference()),
                        () -> assertEquals(125, value.getRequest().getQuantity()),
                        () -> assertEquals("ACKNOWLEDGED", value.getDeliveryStatus().name()),
                        () -> assertEquals(status.name(), value.getBusinessStatus().name()));
                if (outcome == null) assertNull(value.getResult());
                else {
                    assertEquals(status.name(), value.getResult().getStatus().name());
                    assertEquals(time, value.getResult().getCompletedAt());
                    assertEquals(
                            outcome.rejectionCode(),
                            value.getResult().getRejectionCode() == null
                                    ? null
                                    : value.getResult().getRejectionCode().getValue());
                }
                assertEquals(status, mapper.status(BusinessStatus.fromValue(status.name())));
            }
            assertNull(mapper.task(null));
            assertNull(mapper.status(null));
        }
    }

    @Test
    void historyKeepsAllLinksActorVersionAndUtc() {
        try (var context = context()) {
            var mapper = context.getBean(TaskApiMapper.class);
            for (var actor : HistoryEntry.Actor.values())
                for (var type : HistoryType.values()) {
                    var entry =
                            new HistoryEntry(
                                    id,
                                    id,
                                    operation,
                                    time,
                                    actor,
                                    owner,
                                    type,
                                    "История",
                                    operation,
                                    2,
                                    id,
                                    operation,
                                    owner,
                                    id,
                                    "initiator.one");
                    var value = mapper.history(entry);
                    assertAll(
                            () -> assertEquals(id, value.getEventId()),
                            () -> assertEquals(id, value.getTaskId()),
                            () -> assertEquals(operation, value.getOperationId()),
                            () -> assertEquals(time, value.getOccurredAt()),
                            () -> assertEquals(actor.name(), value.getActor().name()),
                            () -> assertEquals(owner, value.getActorUserId()),
                            () -> assertEquals("initiator.one", value.getActorUsername()),
                            () -> assertEquals(type.name(), value.getType().name()),
                            () -> assertEquals("История", value.getSummary()),
                            () -> assertEquals(operation, value.getAttemptId()),
                            () -> assertEquals(2, value.getResultVersion().getValue()),
                            () -> assertEquals(id, value.getIssueId()),
                            () -> assertEquals(operation, value.getReconciliationId()),
                            () -> assertEquals(owner, value.getPreviousAssigneeId()),
                            () -> assertEquals(id, value.getAssignedTo()));
                }
            var sparse =
                    new HistoryEntry(
                            id,
                            id,
                            operation,
                            time,
                            HistoryEntry.Actor.SYSTEM,
                            null,
                            HistoryType.CREATED,
                            "Создано",
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null);
            assertNull(mapper.history(sparse).getActorUsername());
            assertNull(mapper.history(sparse).getResultVersion());
            assertThrows(IllegalArgumentException.class, () -> mapper.historyVersion(3));
        }
    }

    @Test
    void pagesAndCommandsPreserveTotalsWithoutInventingASizeField() {
        try (var context = context()) {
            var mapper = context.getBean(TaskApiMapper.class);
            var page = mapper.tasks(new Page<>(List.of(), 3, 20, 61));
            assertEquals(3, page.getPage());
            assertEquals(61L, page.getTotalItems());
            assertEquals(4L, page.getTotalPages());
            assertFalse(page.getHasNext());
            var empty = mapper.history(new Page<HistoryEntry>(List.of(), 0, 10, 0));
            assertEquals(0L, empty.getTotalPages());
            assertFalse(empty.getHasNext());
            var create = mapper.create(new CreateTaskRequest("Новое", new Request("REQ-000001", 125)));
            assertEquals("Новое", create.title());
            assertEquals(request, create.request());
            var rename = mapper.rename(new RenameTaskRequest("Название", 9007199254740990L));
            assertEquals("Название", rename.title());
            assertEquals(9007199254740990L, rename.expectedTitleRevision());
        }
    }

    @Test
    void reviewKeepsSparseEvidenceAndDerivedActionsWithoutRecalculatingThem() {
        try (var context = context()) {
            var mapper = context.getBean(ReviewApiMapper.class);
            var received =
                    new com.azhukov.integration.domain.exchange.OperationResult(
                            operation,
                            request,
                            2,
                            com.azhukov.integration.domain.task.BusinessStatus.REJECTED,
                            time,
                            "QUANTITY_LIMIT_EXCEEDED");
            var local =
                    new com.azhukov.integration.domain.exchange.LocalSnapshot(
                            request,
                            com.azhukov.integration.domain.task.DeliveryStatus.ACKNOWLEDGED,
                            com.azhukov.integration.domain.task.BusinessStatus.REJECTED,
                            2,
                            new TaskOutcome(
                                    com.azhukov.integration.domain.task.BusinessStatus.REJECTED,
                                    time,
                                    "QUANTITY_LIMIT_EXCEEDED"));
            var resolution =
                    new com.azhukov.integration.domain.review.IssueResolution(
                            id,
                            operation,
                            com.azhukov.integration.domain.review.IssueResolution.Action.ACKNOWLEDGE_DIFFERENCE,
                            "Проверено",
                            owner,
                            time);
            var issue =
                    new com.azhukov.integration.domain.review.Issue(
                            id,
                            id,
                            operation,
                            7,
                            com.azhukov.integration.domain.review.Issue.Kind.RESULT_CONFLICT,
                            com.azhukov.integration.domain.review.Issue.Status.OPEN,
                            time,
                            "Проблема",
                            owner,
                            new Evidence("Конфликт", 9L, local, received),
                            List.of(com.azhukov.integration.domain.review.Issue.Action.RECONCILE),
                            time,
                            operation,
                            resolution);
            var value = mapper.issue(issue);
            assertNull(value.getTaskTitle());
            assertNull(value.getRequestReference());
            var enriched =
                    mapper.issueView(new com.azhukov.integration.dto.review.IssueView(issue, "REQ-000001", "Задание"));
            assertEquals("REQ-000001", enriched.getRequestReference());
            assertEquals("Задание", enriched.getTaskTitle());
            assertEquals(value.getAllowedActions(), enriched.getAllowedActions());
            assertEquals(value.getIssueId(), enriched.getIssueId());
            assertEquals(7L, value.getIssueRevision());
            assertEquals(owner, value.getAssignedTo());
            assertEquals(List.of(Issue.AllowedActionsEnum.RECONCILE), value.getAllowedActions());
            assertEquals(time, value.getNextAttemptAt());
            assertEquals(operation, value.getLatestReconciliationId());
            assertEquals("RESULT_CONFLICT", value.getKind().name());
            assertEquals("OPEN", value.getStatus().name());
            assertEquals("Проблема", value.getSummary());
            assertEquals(time, value.getOpenedAt());
            assertEquals(id, value.getTaskId());
            assertEquals(operation, value.getOperationId());
            assertEquals(id, value.getIssueId());
            assertEquals(9L, value.getEvidence().getCursor());
            assertEquals("Конфликт", value.getEvidence().getReason());
            assertEquals(2, value.getEvidence().getLocal().getResultVersion().getValue());
            assertEquals(time, value.getEvidence().getLocal().getResult().getCompletedAt());
            assertEquals("QUANTITY_LIMIT_EXCEEDED", value.getEvidence().getReceived().getRejectionCode());
            assertEquals(operation, value.getEvidence().getReceived().getOperationId());
            assertEquals("REQ-000001", value.getEvidence().getReceived().getRequest().getReference());
            assertEquals(owner, value.getResolution().getDecidedBy());
            assertEquals("Проверено", value.getResolution().getReason());
            assertEquals(operation, value.getResolution().getReconciliationId());
            assertEquals(time, value.getResolution().getDecidedAt());
            var sparse = mapper.evidence(new Evidence(null, null, null, null));
            assertNotNull(sparse);
            assertNull(sparse.getCursor());
            assertNull(sparse.getLocal());
            assertNull(sparse.getReceived());
            assertNull(mapper.evidence(null));
            assertNull(mapper.resolution(null));
        }
    }

    @Test
    void reconciliationRetainsTheValidatedExternalSnapshotAndRequestCommands() {
        try (var context = context()) {
            var mapper = context.getBean(ReviewApiMapper.class);
            var external = new OperationSnapshot(operation, request, time, 0, null);
            var source =
                    new com.azhukov.integration.domain.review.Reconciliation(
                            id,
                            id,
                            operation,
                            time,
                            owner,
                            com.azhukov.integration.domain.review.Reconciliation.Outcome.DIFFERENCE,
                            new com.azhukov.integration.domain.exchange.LocalSnapshot(
                                    request,
                                    com.azhukov.integration.domain.task.DeliveryStatus.ACKNOWLEDGED,
                                    com.azhukov.integration.domain.task.BusinessStatus.PENDING,
                                    null,
                                    null),
                            com.azhukov.integration.domain.review.Reconciliation.Availability.PRESENT,
                            external,
                            id);
            var value = mapper.reconciliation(source);
            assertSame(external, value.getExternal());
            assertEquals("PRESENT", value.getExternalAvailability().name());
            assertEquals(id, value.getReconciliationId());
            assertEquals(id, value.getTaskId());
            assertEquals(operation, value.getOperationId());
            assertEquals(time, value.getCheckedAt());
            assertEquals(owner, value.getCheckedBy());
            assertEquals(id, value.getIssueId());
            assertEquals("DIFFERENCE", value.getOutcome().name());
            assertNull(value.getLocal().getResult());
            assertNull(value.getLocal().getResultVersion());
            var retry = mapper.retry(new RetryRequest(4L, "Повтор").reconciliationId(id));
            assertEquals(4L, retry.expectedIssueRevision());
            assertEquals("Повтор", retry.reason());
            assertEquals(id, retry.reconciliationId());
            var resolve =
                    mapper.resolve(
                            new ResolveIssueRequest(4L, id, ResolutionAction.APPLY_EXTERNAL_RESULT, "Применить"));
            assertEquals(
                    com.azhukov.integration.domain.review.IssueResolution.Action.APPLY_EXTERNAL_RESULT,
                    resolve.action());
            assertEquals(4L, resolve.expectedIssueRevision());
            assertEquals(id, resolve.reconciliationId());
            assertEquals("Применить", resolve.reason());
            assertEquals(4L, mapper.take(new TakeIssueRequest(4L)).expectedIssueRevision());
        }
    }
}
