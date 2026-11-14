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
    @Autowired com.zaxxer.hikari.HikariDataSource pool;

    @Test
    void validationDeadlineFitsWithinConnectionBorrowDeadline() {
        assertTrue(pool.getValidationTimeout() > 0);
        assertTrue(pool.getValidationTimeout() < pool.getConnectionTimeout());
    }

    @Test
    void actualHttpRejectsNulBeforeStorageAndReturnsRequestCorrelation() throws Exception {
        var owner=login("initiator.one");var id=created(owner,java.util.UUID.randomUUID());
        var cookies=new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL);
        try (var http=HttpClient.newBuilder().cookieHandler(cookies).build()) {
            String base="http://127.0.0.1:"+port;
            var csrf=http.send(HttpRequest.newBuilder(URI.create(base+"/api/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString());
            var login=http.send(HttpRequest.newBuilder(URI.create(base+"/api/login"))
                .header("X-CSRF-TOKEN",json.readTree(csrf.body()).get("token").asString())
                .header("Content-Type","application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("username=initiator.one&password="+PASSWORD)).build(),HttpResponse.BodyHandlers.ofString());
            assertEquals(204,login.statusCode());
            csrf=http.send(HttpRequest.newBuilder(URI.create(base+"/api/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString());
            String token=json.readTree(csrf.body()).get("token").asString();
            String title="До"+Character.toString(0)+"после";
            for (boolean rename:java.util.List.of(false,true)) {
                Object input=rename ? java.util.Map.of("title",title,"expectedTitleRevision",1)
                    : java.util.Map.of("title",title,"request",java.util.Map.of("reference","REQ-000001","quantity",25));
                var response=http.send(HttpRequest.newBuilder(URI.create(base+"/api/tasks"+(rename ? "/"+id : "")))
                    .timeout(Duration.ofSeconds(5)).header("Content-Type","application/json").header("X-CSRF-TOKEN",token)
                    .header("Idempotency-Key",java.util.UUID.randomUUID().toString())
                    .header("X-Request-ID","untrusted").method(rename ? "PATCH" : "POST",HttpRequest.BodyPublishers.ofString(json.writeValueAsString(input))).build(),
                    HttpResponse.BodyHandlers.ofString());
                assertEquals(400,response.statusCode());
                assertEquals("VALIDATION_FAILED",json.readTree(response.body()).get("code").asString());
                assertNotNull(java.util.UUID.fromString(response.headers().firstValue("X-Request-ID").orElseThrow()));
            }
            assertEquals(1,count("tasks"));assertEquals(1,count("command_receipts"));assertEquals(1,count("task_history"));
        }
    }

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
