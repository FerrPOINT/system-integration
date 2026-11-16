package com.azhukov.emulator.scheduler;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

import com.azhukov.emulator.service.OperationService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;

class EmulatorWorkerConfigurationTest {
    private final ApplicationContextRunner runner =
            new ApplicationContextRunner()
                    .withUserConfiguration(WorkerComponents.class)
                    .withBean(OperationService.class, () -> mock(OperationService.class))
                    .withPropertyValues("si.emulator.publication-batch-size=25", "si.emulator.execution-batch-size=5");

    @TestConfiguration(proxyBeanMethods = false)
    @ComponentScan(basePackageClasses = EmulatorWorker.class)
    static class WorkerComponents {}

    @Test
    void missingAndExplicitTrueEnableTheWorker() {
        runner.run(context -> {
            assertNull(context.getStartupFailure());
            assertEquals(1, context.getBeansOfType(EmulatorWorker.class).size());
        });
        for (String value : new String[] {"true", "TRUE"}) {
            runner.withPropertyValues("si.emulator.worker.enabled=" + value)
                    .run(context -> {
                        assertNull(context.getStartupFailure());
                        assertEquals(1, context.getBeansOfType(EmulatorWorker.class).size());
                    });
        }
    }

    @Test
    void explicitFalseDisablesTheWorker() {
        runner.withPropertyValues("si.emulator.worker.enabled=false")
                .run(context -> {
                    assertNull(context.getStartupFailure());
                    assertTrue(context.getBeansOfType(EmulatorWorker.class).isEmpty());
                });
    }

    @Test
    void invalidValuesFailStartupInsteadOfSilentlyDisablingWork() {
        for (String value : new String[] {"tru", "on", "yes", "1", "", " "}) {
            runner.withPropertyValues("si.emulator.worker.enabled=" + value)
                    .run(context -> {
                        var failure = context.getStartupFailure();
                        assertNotNull(failure, "Invalid worker setting: " + value);
                        while (failure.getCause() != null) failure = failure.getCause();
                        assertTrue(failure.getMessage().contains("si.emulator.worker.enabled"), failure::getMessage);
                    });
        }
    }
}
