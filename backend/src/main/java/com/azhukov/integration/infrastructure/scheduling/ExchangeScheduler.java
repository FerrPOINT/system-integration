package com.azhukov.integration.infrastructure.scheduling;

import lombok.RequiredArgsConstructor;
import com.azhukov.integration.application.ExchangeCoordinator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name="si.exchange.enabled",havingValue="true",matchIfMissing=true)
@RequiredArgsConstructor
public class ExchangeScheduler {
    private final ExchangeCoordinator exchange;

    @Scheduled(fixedDelay=100)
    void deliver() { exchange.deliver(); }
    @Scheduled(fixedDelay=200)
    void receive() { exchange.receive(); }
}
