package com.azhukov.integration.application.port;

import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.review.Reconciliation.Availability;
import java.util.UUID;

public interface OperationLookup {
    Lookup lookup(UUID operationId);

    /** Raw evidence is opaque outside the HTTP adapter; application never parses it. */
    record Lookup(Availability availability, OperationSnapshot external, String protocolFailure, Object evidence) {}
}
