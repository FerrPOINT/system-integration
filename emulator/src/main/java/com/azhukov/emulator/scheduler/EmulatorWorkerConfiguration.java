package com.azhukov.emulator.scheduler;

import com.azhukov.emulator.service.OperationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Validate the switch even when the conditional worker bean will not be registered. */
@Configuration(proxyBeanMethods = false)
class EmulatorWorkerConfiguration {
    EmulatorWorkerConfiguration(@Value("${si.emulator.worker.enabled:true}") String enabled) {
        if (!"true".equalsIgnoreCase(enabled) && !"false".equalsIgnoreCase(enabled))
            throw new IllegalArgumentException("si.emulator.worker.enabled must be true or false");
    }

    @Bean
    @ConditionalOnProperty(name = "si.emulator.worker.enabled", havingValue = "true", matchIfMissing = true)
    EmulatorWorker emulatorWorker(
            OperationService operations,
            @Value("${si.emulator.publication-batch-size}") int publicationBatch,
            @Value("${si.emulator.execution-batch-size}") int executionBatch) {
        return new EmulatorWorker(operations, publicationBatch, executionBatch);
    }
}
