package com.azhukov.integration.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

import com.azhukov.integration.service.ExchangeCoordinator;
import com.azhukov.integration.service.ExchangeService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class EndpointWorkerSettingsTest {
    private final ApplicationContextRunner context =
            new ApplicationContextRunner()
                    .withBean(ExchangeCoordinator.class, () -> mock(ExchangeCoordinator.class))
                    .withBean(ExchangeService.class, () -> mock(ExchangeService.class))
                    .withUserConfiguration(ExchangeDiagnosticsEndpoint.class, WorkerCondition.class);

    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    static class WorkerCondition {
        @org.springframework.context.annotation.Bean
        @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
                name = "si.exchange.enabled",
                havingValue = "true",
                matchIfMissing = true)
        Object scheduledWorker() {
            return new Object();
        }
    }

    @Test
    void defaultAndExplicitFlagsAgreeWithTheScheduledWorkerCondition() {
        context.run(ctx -> {
            assertTrue(ctx.containsBean("scheduledWorker"));
            assertTrue(ctx.getBean(ExchangeDiagnosticsEndpoint.class).read().workerEnabled());
        });
        for (String value : new String[] {"true", "TRUE", "false", "FALSE"})
            context.withPropertyValues("si.exchange.enabled=" + value)
                    .run(ctx -> {
                        assertEquals(value.equalsIgnoreCase("true"), ctx.containsBean("scheduledWorker"));
                        assertEquals(
                                ctx.containsBean("scheduledWorker"),
                                ctx.getBean(ExchangeDiagnosticsEndpoint.class).read().workerEnabled());
                    });
    }

    @Test
    void unsupportedBooleanAliasesMustNotReportAWorkerWhichTheConditionDisables() {
        for (String value : new String[] {"yes", "on", "1", "no", "off", "0", "typo"})
            context.withPropertyValues("si.exchange.enabled=" + value)
                    .run(ctx ->
                            assertNotNull(ctx.getStartupFailure(), "Unsupported flag must fail explicitly: " + value));
    }
}
