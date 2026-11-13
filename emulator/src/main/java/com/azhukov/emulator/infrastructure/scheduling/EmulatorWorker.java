package com.azhukov.emulator.infrastructure.scheduling;

import com.azhukov.emulator.application.OperationService;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "si.emulator.worker.enabled", havingValue = "true", matchIfMissing = true)
class EmulatorWorker {
    private final OperationService operations;
    private final int publicationBatch;

    EmulatorWorker(OperationService operations,@Value("${si.emulator.publication-batch-size}") int publicationBatch) {
        if (publicationBatch<1 || publicationBatch>OperationService.MAX_PUBLICATION_BATCH)
            throw new IllegalArgumentException("si.emulator.publication-batch-size must be 1..100");
        this.operations=operations; this.publicationBatch=publicationBatch;
    }

    @Scheduled(fixedDelay = 250)
    void execute() {
        for (int n = 0; n < 50 && operations.executeNext(); n++) { }
    }

    @Scheduled(fixedDelay = 250)
    void publish() {
        int published=0;
        while (published<100) {
            int count=operations.publish(Math.min(publicationBatch,100-published));
            if (count==0) break;
            published+=count;
        }
    }
}
