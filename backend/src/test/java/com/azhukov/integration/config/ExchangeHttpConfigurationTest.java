package com.azhukov.integration.config;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.io.ClassPathResource;

import static org.junit.jupiter.api.Assertions.*;

class ExchangeHttpConfigurationTest {
    private ApplicationContextRunner runner() {
        return new ApplicationContextRunner().withUserConfiguration(ExchangeHttpConfiguration.class)
            .withPropertyValues("si.exchange.http.base-url=http://127.0.0.1")
            .withInitializer(context -> {
                try {
                    context.getEnvironment().getPropertySources().addLast(
                        new YamlPropertySourceLoader().load("application",new ClassPathResource("application.yml")).getFirst());
                } catch (IOException error) { throw new UncheckedIOException(error); }
            });
    }

    @Test
    void actualYamlDefaultsBindAndSpringClosesTheSingleClient() {
        var owned=new AtomicReference<HttpClient>();
        runner().run(context -> {
            assertNull(context.getStartupFailure());
            assertEquals(1,context.getBeansOfType(HttpClient.class).size());
            var settings=context.getBean(ExchangeHttpProperties.class);
            assertEquals(Duration.ofSeconds(1),settings.connectTimeout());
            assertEquals(Duration.ofSeconds(2),settings.responseTimeout());
            assertEquals(262144,settings.maxResponseSize().toBytes());
            owned.set(context.getBean(HttpClient.class));
        });
        assertTrue(owned.get().isTerminated(),"Spring must close its HTTP resource on context shutdown");
    }

    @Test
    void invalidOriginsDeadlinesAndSizesFailAtBindingInsteadOfFallingBack() {
        for (String setting:new String[]{
            "base-url=ftp://127.0.0.1","base-url=http://user:password@127.0.0.1",
            "base-url=http://127.0.0.1/path","connect-timeout=0s","response-timeout=-1s",
            "response-timeout=11s","connect-timeout=3s","max-response-size=0B","max-response-size=2MB"}) {
            runner().withPropertyValues("si.exchange.http."+setting).run(context -> {
                assertNotNull(context.getStartupFailure(),setting);
                assertTrue(context.getStartupFailure().toString().contains("si.exchange.http"));
            });
        }
    }
}
