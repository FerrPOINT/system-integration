package com.azhukov.integration.config;

import com.azhukov.integration.repository.ExchangeRepository;
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
@Endpoint(id="exchange")
public class ExchangeDiagnosticsEndpoint {
    private final ExchangeCoordinator coordinator;
    private final ExchangeService exchange;
    private final boolean enabled;

    public ExchangeDiagnosticsEndpoint(ExchangeCoordinator coordinator,ExchangeService exchange,
                                       @Value("${si.exchange.enabled:true}") boolean enabled) {
        this.coordinator=coordinator;this.exchange=exchange;this.enabled=enabled;
    }

    public record Diagnostics(Instant observedAt,boolean workerEnabled,
                              ExchangeCoordinator.FeedDiagnostics feed,
                              ExchangeRepository.DeliveryBacklog deliveryQueue) {}

    @ReadOperation
    public Diagnostics read() {
        var backlog=exchange.backlog();
        return new Diagnostics(Instant.now(),enabled,coordinator.diagnostics(),backlog);
    }
}
