package com.azhukov.integration.controller;

import com.azhukov.integration.dto.exchange.DeliveryBacklog;
import com.azhukov.integration.service.ExchangeCoordinator;
import com.azhukov.integration.service.ExchangeService;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.endpoint.annotation.Endpoint;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.stereotype.Component;

/**
 * Operator-only diagnostics on the private backend route. A request reads the queue
 * once; there is no polling worker or extra work on ordinary application requests.
 * External availability never changes readiness: local acceptance must remain possible.
 */
@Component
@Endpoint(id = "exchange")
public class ExchangeDiagnosticsEndpoint {
    private final ExchangeCoordinator coordinator;
    private final ExchangeService exchange;
    private final boolean enabled;

    public ExchangeDiagnosticsEndpoint(
            ExchangeCoordinator coordinator,
            ExchangeService exchange,
            @Value("${si.exchange.enabled:true}") String enabled) {
        // ConditionalOnProperty matches only these literals; Boolean conversion also accepts yes/on/1.
        if (!"true".equalsIgnoreCase(enabled) && !"false".equalsIgnoreCase(enabled))
            throw new IllegalArgumentException("si.exchange.enabled must be true or false");
        this.coordinator = coordinator;
        this.exchange = exchange;
        this.enabled = Boolean.parseBoolean(enabled);
    }

    public record Diagnostics(
            Instant observedAt,
            boolean workerEnabled,
            ExchangeCoordinator.FeedDiagnostics feed,
            DeliveryBacklog deliveryQueue) {}

    @ReadOperation
    public Diagnostics read() {
        var backlog = exchange.backlog();
        return new Diagnostics(Instant.now(), enabled, coordinator.diagnostics(), backlog);
    }
}
