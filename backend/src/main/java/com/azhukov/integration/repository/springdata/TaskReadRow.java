package com.azhukov.integration.repository.springdata;

import com.azhukov.integration.domain.task.*;
import com.azhukov.integration.repository.mapping.TaskResultReader;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Column;
import org.springframework.data.relational.core.mapping.Table;

/** Flat read projection of tasks; deliberately has no writable aggregate or child collections. */
@Table("tasks")
record TaskReadRow(
        @Id UUID id,
        @Column("operation_id") UUID operationId,
        @Column("owner_id") UUID ownerId,
        String title,
        @Column("title_revision") long titleRevision,
        @Column("request_reference") String requestReference,
        @Column("request_quantity") int requestQuantity,
        @Column("delivery_status") DeliveryStatus deliveryStatus,
        @Column("business_status") BusinessStatus businessStatus,
        @Column("created_at") OffsetDateTime createdAt,
        @Column("accepted_result") String acceptedResult) {
    Task task(TaskResultReader results) {
        return new Task(
                id,
                operationId,
                ownerId,
                new TaskTitle(title, titleRevision),
                new TaskInput(requestReference, requestQuantity),
                deliveryStatus,
                businessStatus,
                createdAt,
                results.outcome(businessStatus, acceptedResult));
    }
}
