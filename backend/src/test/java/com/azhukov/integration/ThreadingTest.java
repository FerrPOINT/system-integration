package com.azhukov.integration;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.TaskScheduler;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;

@Tag("postgres")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "si.exchange.enabled=false")
@Import(ThreadingTest.ProbeConfiguration.class)
class ThreadingTest extends com.azhukov.integration.support.PostgresTest {
    @LocalServerPort int port;
    @Autowired TaskScheduler scheduler;

    @Test
    void actualHttpRequestUsesVirtualThread() throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/thread-test"))
                .timeout(Duration.ofSeconds(3)).GET().build();
            var reply = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertEquals(200, reply.statusCode());
            assertEquals("true", reply.body());
        }
    }

    @Test
    void blockedFixedDelayTaskDoesNotPreventAnotherTaskFromProgressing() throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var progressed = new CountDownLatch(1);
        var blocked = scheduler.scheduleWithFixedDelay(() -> {
            entered.countDown();
            try { release.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }, Duration.ofMillis(10));
        java.util.concurrent.ScheduledFuture<?> other = null;
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS), "first task did not start");
            other = scheduler.scheduleWithFixedDelay(progressed::countDown, Duration.ofMillis(10));
            assertTrue(progressed.await(2, TimeUnit.SECONDS), "second task was starved by fixedDelay wait");
        } finally {
            release.countDown();
            blocked.cancel(true);
            if (other != null) other.cancel(true);
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ProbeConfiguration {
        @Bean
        org.springframework.boot.web.servlet.FilterRegistrationBean<jakarta.servlet.Filter> threadProbe() {
            var probe = new org.springframework.boot.web.servlet.FilterRegistrationBean<jakarta.servlet.Filter>(
                (request, response, chain) -> {
                    response.setContentType("text/plain");
                    response.getWriter().print(Thread.currentThread().isVirtual());
                });
            probe.addUrlPatterns("/thread-test");
            probe.setOrder(org.springframework.core.Ordered.HIGHEST_PRECEDENCE);
            return probe;
        }
    }
}
