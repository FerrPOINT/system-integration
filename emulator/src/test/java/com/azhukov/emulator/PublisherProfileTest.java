package com.azhukov.emulator;

import com.azhukov.emulator.application.OperationService;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

@Tag("postgres")
@SpringBootTest(properties="si.emulator.worker.enabled=false")
class PublisherProfileTest {
    @Autowired OperationService service;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url",() -> "jdbc:postgresql://127.0.0.1:19632/si_emulator_test");
        properties.add("spring.datasource.username",() -> "si_emulator_test");
        properties.add("spring.datasource.password",() -> System.getenv("SI_EMULATOR_TEST_DB_PASSWORD"));
    }

    @Test
    void profilePublicationTransactionsOnAFixedIsolatedDataset() throws Exception {
        var reports=new ArrayList<Map<String,Object>>();
        int[][] orders={{1,10,25,50},{50,25,10,1},{25,1,50,10}};
        for (int round=0;round<orders.length;round++)
            for (int batch:orders[round]) reports.add(Map.of("round",round+1,"profile",profile(batch)));
        var output=Path.of("../tests/results/publisher-profile.json");
        Files.createDirectories(output.getParent());
        Files.writeString(output,json.writeValueAsString(reports));
    }

    private Map<String,Object> profile(int batch) throws Exception {
        assertEquals("si_emulator_test",jdbc.queryForObject("SELECT current_database()",String.class));
        assertEquals("si_emulator_test",jdbc.queryForObject("SELECT current_user",String.class));
        jdbc.execute("TRUNCATE result_events,faults,operations CASCADE");
        jdbc.update("UPDATE feed_position SET last_cursor=0 WHERE id=1");
        try {
            jdbc.update("""
                INSERT INTO operations(id,reference,quantity,accepted_at,executions,result,completed_at)
                SELECT md5('publisher-profile:'||i)::uuid,'REQ-'||(700000+i),25,'2026-11-12'::timestamptz+i*interval '1 millisecond',1,
                jsonb_build_object('operationId',md5('publisher-profile:'||i)::uuid,
                    'request',jsonb_build_object('reference','REQ-'||(700000+i),'quantity',25),
                    'version',2,'status','SUCCEEDED','completedAt','2026-11-12T12:00:00Z'),'2026-11-12T12:00:00Z'::timestamptz
                FROM generate_series(1,1000)i
                """);
            jdbc.update("""
                INSERT INTO result_events(operation_id,version,copy_number,payload,publish_after,created_at)
                SELECT o.id,v,0,CASE WHEN v=2 THEN o.result ELSE jsonb_build_object('operationId',o.id,
                    'request',jsonb_build_object('reference',o.reference,'quantity',o.quantity),'version',1,'status','RUNNING') END,
                    clock_timestamp(),o.accepted_at+v*interval '1 microsecond'
                FROM operations o CROSS JOIN generate_series(1,2)v
                """);
            var durations=new ArrayList<Double>();
            int published=0;
            long started=System.nanoTime();
            while (true) {
                long before=System.nanoTime();
                int count=service.publish(batch);
                durations.add((System.nanoTime()-before)/1_000_000d);
                if (count==0) break;
                published+=count;
                assertTrue(published<=2000,"A finite fixture must finish without repeated publication");
            }
            double elapsed=(System.nanoTime()-started)/1_000_000d;
            durations.sort(Double::compare);
            long assigned=jdbc.queryForObject("SELECT count(DISTINCT cursor) FROM result_events WHERE cursor IS NOT NULL",Long.class);
            long last=jdbc.queryForObject("SELECT last_cursor FROM feed_position WHERE id=1",Long.class);
            var report=Map.<String,Object>of("batch",batch,"recordedAt",Instant.now().toString(),"events",published,"transactions",durations.size(),
                "elapsedMs",elapsed,"transactionP95Ms",durations.get((int)Math.ceil(durations.size()*0.95)-1),
                "uniqueCursors",assigned,"lastCursor",last,
                "scope","Native Spring transaction proxy with PostgreSQL on fixed synthetic data; not container throughput or end-to-end capacity");
            assertEquals(2000,published);
            assertEquals(2000,assigned);
            assertEquals(2000,last);
            return report;
        } finally {
            jdbc.execute("TRUNCATE result_events,faults,operations CASCADE");
            jdbc.update("UPDATE feed_position SET last_cursor=0 WHERE id=1");
        }
    }
}
