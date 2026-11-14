package com.azhukov.integration.tasks;

import com.azhukov.integration.client.http.ExchangeReply;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import com.azhukov.integration.support.ReadSqlCapture;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAccumulator;
import java.util.concurrent.atomic.LongAdder;
import org.aopalliance.intercept.MethodInterceptor;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static com.azhukov.integration.support.ExchangeTestData.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** Real JDBC-call frequency and elapsed time for a fixed workflow, not a load benchmark. */
@Import({SqlWorkflowProfileTest.SqlObservation.class,ReadSqlCapture.class})
class SqlWorkflowProfileTest extends PostgresTest {
    private static final Map<String,Timing> TIMINGS = new ConcurrentHashMap<>();
    @Autowired ExchangeService exchange;
    private final List<Map<String,Object>> steps = new java.util.ArrayList<>();
    private final List<ReadSqlCapture.Statement> generatedReads = new java.util.ArrayList<>();

    @Test
    void recordsTheWholeSuccessfulWorkflowWithoutCapturingParameters() throws Exception {
        var owner = login("initiator.one");
        TIMINGS.clear(); // Authentication/fixture preparation is outside this profile.
        UUID key = UUID.randomUUID();
        UUID task = step("create",() -> created(owner,key));
        status(201,step("create-replay",() -> create(owner,key,CREATE))); // completed command replay
        var renameKey = UUID.randomUUID();
        status(200,step("rename",() -> rename(owner,task,renameKey,"Новое имя",1)));
        status(200,step("rename-replay",() -> rename(owner,task,renameKey,"Новое имя",1)));
        status(200,step("list",() -> mvc.perform(get("/api/tasks").session(owner.session())).andReturn()));
        status(200,step("card",() -> mvc.perform(get("/api/tasks/"+task).session(owner.session())).andReturn()));
        var claim = step("claim",exchange::claim); assertNotNull(claim);
        var identity = Map.of("operationId",claim.operationId(),"request",claim.request());
        var acknowledgement = new java.util.LinkedHashMap<String,Object>(identity);
        acknowledgement.put("acceptedAt","2026-01-01T00:00:00Z");
        step("ack",() -> { finish(exchange,claim,new ExchangeReply(202,json.valueToTree(acknowledgement),false,null)); return null; });
        var running = new java.util.LinkedHashMap<String,Object>(identity);
        running.put("version",1); running.put("status","RUNNING");
        var terminal = new java.util.LinkedHashMap<String,Object>(identity);
        terminal.put("version",2); terminal.put("status","SUCCEEDED"); terminal.put("completedAt","2026-01-01T00:00:01Z");
        var page = json.valueToTree(List.of(Map.of("cursor",1,"result",running),Map.of("cursor",2,"result",terminal)));
        assertTrue(step("consume-two-results",() -> consume(exchange,0,page)));
        status(200,step("history",() -> mvc.perform(get("/api/tasks/"+task+"/history").session(owner.session())).andReturn()));
        var finalCard = step("final-card",() -> mvc.perform(get("/api/tasks/"+task).session(owner.session())).andReturn());
        status(200,finalCard);
        assertEquals("SUCCEEDED",body(finalCard).get("businessStatus").asString());

        var measured = TIMINGS.entrySet().stream().sorted(Map.Entry.comparingByKey()).map(entry -> Map.of(
            "sql",entry.getKey(),"calls",entry.getValue().calls.sum(),
            "elapsedNanos",entry.getValue().elapsed.sum(),"maxNanos",entry.getValue().maximum.get())).toList();
        assertFalse(measured.isEmpty());
        var report = Map.of("recordedAt",Instant.now().toString(),"workflow","create/replay/rename/replay/list/card/claim/ack/two-results/history/card",
            "scope","single PostgreSQL workflow; manual JDBC timings plus driver-observed generated reads; no commit/connection acquisition timing",
            "parametersCaptured",false,"queries",measured,"steps",steps,
            "generatedReadSql",generatedReads.stream().map(ReadSqlCapture.Statement::sql).toList());
        assertFalse(generatedReads.isEmpty(),"Driver observation must cover Spring Data reads as well as manual JDBC");
        var output = Path.of("../tests/results/sql-workflow.json");
        Files.createDirectories(output.getParent());
        Files.writeString(output,json.writerWithDefaultPrettyPrinter().writeValueAsString(report));
    }

    @Test
    void claimReadsItsLockedTaskOnlyOnce() throws Exception {
        created(login("initiator.one"),UUID.randomUUID());
        TIMINGS.clear();
        assertNotNull(exchange.claim());
        assertEquals(1,taskReadCalls(),"The task selected and locked for a claim must not be loaded again");
    }

    @Test
    void aHundredEventPageLoadsLockedStateOnceAndKeepsBothVersions() throws Exception {
        var owner=login("initiator.one");
        var page=json.createArrayNode();
        for (int n=0;n<50;n++) {
            created(owner,UUID.randomUUID());
            var claim=exchange.claim();
            for (int version=1;version<=2;version++) {
                var result=json.createObjectNode().put("operationId",claim.operationId().toString())
                    .set("request",json.valueToTree(claim.request())).put("version",version)
                    .put("status",version==1 ? "RUNNING" : "SUCCEEDED");
                if (version==2) result.put("completedAt","2026-01-01T00:00:01Z");
                page.add(json.createObjectNode().put("cursor",page.size()+1).set("result",result));
            }
        }
        TIMINGS.clear();
        assertTrue(consume(exchange,0,page));
        long reads=taskReadCalls();
        assertEquals(100,exchange.cursor());
        assertEquals(50,jdbc.queryForObject("SELECT count(*) FROM tasks WHERE business_status='SUCCEEDED' AND exchange_version=3",Integer.class));
        assertEquals(100,jdbc.queryForObject("SELECT count(*) FROM task_history WHERE event_type='RESULT_APPLIED'",Integer.class));
        assertEquals(0,count("delivery_queue"));
        assertEquals(1,reads,"Page state must be loaded by one bounded locking query, not once per result");
    }

    private long taskReadCalls() {
        return TIMINGS.entrySet().stream().filter(entry -> {
            String sql=entry.getKey().toUpperCase(java.util.Locale.ROOT);
            return sql.startsWith("SELECT") && sql.contains("FROM TASKS");
        }).mapToLong(entry -> entry.getValue().calls.sum()).sum();
    }

    private <T> T step(String name,CheckedSupplier<T> operation) throws Exception {
        long before = TIMINGS.values().stream().mapToLong(t -> t.calls.sum()).sum();
        long started = System.nanoTime();
        try {
            var observed=ReadSqlCapture.record(operation::get);
            generatedReads.addAll(observed.statements().stream().filter(s -> s.sql().contains("FROM \"tasks\"")
                || s.sql().contains("FROM \"task_history\"")).toList());
            return observed.value();
        }
        finally {
            long after = TIMINGS.values().stream().mapToLong(t -> t.calls.sum()).sum();
            steps.add(Map.of("name",name,"jdbcCalls",after-before,"elapsedNanos",System.nanoTime()-started));
        }
    }

    @FunctionalInterface
    private interface CheckedSupplier<T> { T get() throws Exception; }

    private static final class Timing {
        final LongAdder calls = new LongAdder();
        final LongAdder elapsed = new LongAdder();
        final LongAccumulator maximum = new LongAccumulator(Long::max,0);
        void record(long nanos) { calls.increment(); elapsed.add(nanos); maximum.accumulate(nanos); }
    }

    @TestConfiguration(proxyBeanMethods=false)
    static class SqlObservation {
        @Bean
        static BeanPostProcessor observeJdbc() {
            return new BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean,String name) {
                    if (!(bean instanceof JdbcTemplate)) return bean;
                    var factory = new ProxyFactory(bean);
                    factory.setProxyTargetClass(true);
                    factory.addAdvice((MethodInterceptor) invocation -> {
                        var args = invocation.getArguments();
                        if (args.length==0 || !(args[0] instanceof String sql) ||
                            !List.of("query","queryForObject","update").contains(invocation.getMethod().getName()))
                            return invocation.proceed();
                        var started = System.nanoTime();
                        try { return invocation.proceed(); }
                        finally { TIMINGS.computeIfAbsent(sql.strip().replaceAll("\\s+"," "),ignored -> new Timing()).record(System.nanoTime()-started); }
                    });
                    return factory.getProxy();
                }
            };
        }
    }
}
