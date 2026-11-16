package com.azhukov.emulator.scheduler;

import com.azhukov.emulator.service.OperationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Independent execution/publication triggers on the explicit platform scheduler.
 * Publication defaults to 25 (valid 1..100), with at most 100 events per pass;
 * execution handles at most 50 operations, without starving publication.
 */
@Component
@ConditionalOnProperty(name = "si.emulator.worker.enabled", havingValue = "true", matchIfMissing = true)
class EmulatorWorker {
    private final OperationService operations;
    private final int publicationBatch;
    private final int executionBatch;

    EmulatorWorker(
            OperationService operations,
            @Value("${si.emulator.publication-batch-size}") int publicationBatch,
            @Value("${si.emulator.execution-batch-size}") int executionBatch) {
        if (publicationBatch < 1 || publicationBatch > OperationService.MAX_PUBLICATION_BATCH)
            throw new IllegalArgumentException("si.emulator.publication-batch-size must be 1..100");
        if (executionBatch < 1 || executionBatch > OperationService.MAX_EXECUTION_BATCH)
            throw new IllegalArgumentException("si.emulator.execution-batch-size must be 1..25");
        this.executionBatch = executionBatch;
        this.operations = operations;
        this.publicationBatch = publicationBatch;
    }

    @Scheduled(fixedDelay = 250)
    void execute() {
        int executed = 0;
        while (executed < 50) {
            int count = operations.executeNext(Math.min(executionBatch, 50 - executed));
            if (count == 0) break;
            executed += count;
        }
    }

    @Scheduled(fixedDelay = 250)
    void publish() {
        int published = 0;
        while (published < 100) {
            int count = operations.publish(Math.min(publicationBatch, 100 - published));
            if (count == 0) break;
            published += count;
        }
    }
}
