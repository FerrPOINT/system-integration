package com.azhukov.emulator.infrastructure.scheduling;

import com.azhukov.emulator.application.OperationService;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "si.emulator.worker.enabled", havingValue = "true", matchIfMissing = true)
class EmulatorWorker {
    private final OperationService operations;

    EmulatorWorker(OperationService operations) { this.operations = operations; }

    @Scheduled(fixedDelay = 250)
    void execute() {
        for (int n = 0; n < 50 && operations.executeNext(); n++) { }
    }

    @Scheduled(fixedDelay = 250)
    void publish() {
        for (int n = 0; n < 100 && operations.publishNext(); n++) { }
    }
}
