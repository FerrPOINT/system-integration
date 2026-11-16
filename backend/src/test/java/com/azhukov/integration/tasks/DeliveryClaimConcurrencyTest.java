package com.azhukov.integration.tasks;

import static com.azhukov.integration.support.ExchangeTestData.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.client.http.ExchangeReply;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.dto.exchange.ClaimResult;
import com.azhukov.integration.repository.ExchangeRepository;
import com.azhukov.integration.service.ExchangeCoordinator;
import com.azhukov.integration.service.ExchangeService;
import com.azhukov.integration.support.PostgresTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

class DeliveryClaimConcurrencyTest extends PostgresTest {
    @Autowired ExchangeService exchange;
    @MockitoSpyBean ExchangeRepository rows;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {8, 32})
    void concurrentSlotsKeepOneCommittedAttemptPerOperation(int slots) throws Exception {
        var owner = login("initiator.one");
        for (int n = 0; n < 32; n++) created(owner, UUID.randomUUID());
        var delivered = java.util.concurrent.ConcurrentHashMap.<UUID>newKeySet();
        var client = mock(ExternalExchangeClient.class);
        when(client.deliver(any()))
                .thenAnswer(call -> {
                    DeliveryAttempt attempt = call.getArgument(0);
                    assertTrue(
                            delivered.add(attempt.operationId()),
                            "A committed lease may not be stolen by another slot");
                    return new ExternalExchangeClient.DeliveryReply(
                            DeliveryAttempt.Outcome.ACKNOWLEDGED, 202, false, null, null);
                });
        try (var worker = new ExchangeCoordinator(exchange, client, slots)) {
            for (int pass = 0; count("delivery_queue") > 0 && pass < 16; pass++) worker.deliver();
        }
        assertEquals(32, delivered.size());
        assertEquals(0, count("delivery_queue"));
        assertEquals(32, count("delivery_attempts"));
        assertEquals(1, jdbc.queryForObject("SELECT max(number) FROM delivery_attempts", Integer.class));
        assertEquals(
                0,
                jdbc.queryForObject(
                        "SELECT count(*) FROM delivery_attempts WHERE outcome <> 'ACKNOWLEDGED' OR outcome IS NULL",
                        Integer.class));
    }

    @Test
    void aStaleCandidateCannotInterruptAnUnexpiredCommittedLease() throws Exception {
        created(login("initiator.one"), UUID.randomUUID());
        var firstClaim = exchange.claim().attempt();
        assertNotNull(firstClaim);
        var stale = rows.exchange(firstClaim.operationId(), false);
        doReturn(stale).when(rows).lockDueExchange();
        int historyBefore = count("task_history");

        var result = exchange.claim();
        assertEquals(ClaimResult.Outcome.SKIPPED, result.outcome());
        assertNull(result.attempt());
        assertEquals(
                firstClaim.attemptId(),
                jdbc.queryForObject(
                        "SELECT claim_id FROM delivery_queue WHERE operation_id=?",
                        UUID.class,
                        firstClaim.operationId()));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT automatic_attempts FROM delivery_queue WHERE operation_id=?",
                        Integer.class,
                        firstClaim.operationId()));
        assertNull(
                jdbc.queryForObject(
                        "SELECT outcome FROM delivery_attempts WHERE id=?", String.class, firstClaim.attemptId()));
        assertEquals(historyBefore, count("task_history"));
    }

    @Test
    void aStaleCandidateCannotBypassACommittedFutureRetryTime() throws Exception {
        created(login("initiator.one"), UUID.randomUUID());
        var firstClaim = exchange.claim().attempt();
        finish(exchange, firstClaim, new ExchangeReply(503, null, false, null));
        jdbc.update(
                "UPDATE delivery_queue SET due_at=clock_timestamp()+interval '1 hour' WHERE operation_id=?",
                firstClaim.operationId());
        var stale = rows.exchange(firstClaim.operationId(), false);
        doReturn(stale).when(rows).lockDueExchange();
        int historyBefore = count("task_history");

        var result = exchange.claim();
        assertEquals(ClaimResult.Outcome.SKIPPED, result.outcome());
        assertNull(result.attempt());
        assertEquals(1, count("delivery_attempts"));
        assertEquals(
                1,
                jdbc.queryForObject(
                        "SELECT automatic_attempts FROM delivery_queue WHERE operation_id=?",
                        Integer.class,
                        firstClaim.operationId()));
        assertEquals(historyBefore, count("task_history"));
    }
}
