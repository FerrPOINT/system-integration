package com.azhukov.integration.client;

import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.review.Reconciliation.Availability;
import java.util.List;
import java.util.UUID;

public interface ExternalExchangeClient {
    DeliveryReply deliver(DeliveryAttempt attempt);

    FeedReply events(long after);

    Lookup lookup(UUID operationId);

    /** Internal-only classification; content retains the original deduplication identity. */
    record ProtocolEvidence(Object content, String detail) {}

    record Lookup(Availability availability, OperationSnapshot external, String protocolFailure, Object evidence) {}

    record DeliveryReply(
            DeliveryAttempt.Outcome outcome,
            int httpStatus,
            boolean connectionFailed,
            String protocolFailure,
            Object evidence) {}

    enum FeedStatus {
        READY,
        UNAVAILABLE,
        INVALID_PAGE
    }

    record IncomingEvent(long cursor, UUID operationId, OperationResult result, Object evidence) {}

    record FeedReply(FeedStatus status, List<IncomingEvent> events, Object evidence) {
        public FeedReply {
            events = List.copyOf(events);
        }
    }
}
