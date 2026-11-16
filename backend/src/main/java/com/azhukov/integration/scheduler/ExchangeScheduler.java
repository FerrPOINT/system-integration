package com.azhukov.integration.scheduler;

import com.azhukov.integration.service.ExchangeCoordinator;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Thin fixed-delay triggers. The explicit two-thread platform scheduler keeps
 * delivery and result ingestion independent when virtual HTTP threads are enabled.
 */
@Component
@ConditionalOnProperty(name = "si.exchange.enabled", havingValue = "true", matchIfMissing = true)
@RequiredArgsConstructor
public class ExchangeScheduler {
    private final ExchangeCoordinator exchange;

    @Scheduled(fixedDelay = 100)
    void deliver() {
        exchange.deliver();
    }

    @Scheduled(fixedDelay = 200)
    void receive() {
        exchange.receive();
    }
}
