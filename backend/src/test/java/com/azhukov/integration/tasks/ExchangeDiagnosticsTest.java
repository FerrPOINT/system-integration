package com.azhukov.integration.tasks;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.client.http.HttpExternalExchangeClient;
import com.azhukov.integration.service.ExchangeCoordinator;
import com.azhukov.integration.support.PostgresTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class ExchangeDiagnosticsTest extends PostgresTest {
    @MockitoBean HttpExternalExchangeClient client;
    @Autowired ExchangeCoordinator worker;

    @Test
    void operatorCanInspectQueueAndPausedFeedWithoutChangingReadinessOrBusinessData() throws Exception {
        status(401,mvc.perform(get("/actuator/exchange")).andReturn());
        var owner=login("initiator.one");
        status(403,mvc.perform(get("/actuator/exchange").session(owner.session())).andReturn());
        var op=login("operator");
        var empty=mvc.perform(get("/actuator/exchange").session(op.session())).andReturn();status(200,empty);
        assertEquals(0,body(empty).at("/deliveryQueue/operations").asLong());
        assertTrue(body(empty).at("/deliveryQueue/oldestCreatedAt").isNull());
        var task=created(owner,UUID.randomUUID());
        var before=count("task_history");
        var queue=mvc.perform(get("/actuator/exchange").session(op.session())).andReturn();status(200,queue);
        assertEquals(1,body(queue).at("/deliveryQueue/operations").asLong());
        assertFalse(body(queue).at("/deliveryQueue/oldestCreatedAt").isNull());
        assertEquals(before,count("task_history"));
        when(client.events(0)).thenReturn(new ExternalExchangeClient.FeedReply(
            ExternalExchangeClient.FeedStatus.INVALID_PAGE,List.of(),null));
        worker.receive();worker.receive();
        var paused=mvc.perform(get("/actuator/exchange").session(op.session())).andReturn();status(200,paused);
        assertTrue(body(paused).at("/feed/paused").asBoolean());
        assertEquals(1,body(paused).at("/feed/invalidPages").asLong());
        verify(client,times(1)).events(0);
        status(200,mvc.perform(get("/actuator/health/readiness")).andReturn());
        assertEquals(before,count("task_history"));
        assertEquals("PENDING",jdbc.queryForObject("SELECT business_status FROM tasks WHERE id=?",String.class,task));
    }
}
