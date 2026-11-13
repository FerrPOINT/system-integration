package com.azhukov.integration.support;

import com.azhukov.integration.application.ExchangeTasks;
import com.azhukov.integration.application.port.ExternalExchange.FeedStatus;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.infrastructure.http.ExchangeProtocol;
import com.azhukov.integration.infrastructure.http.ExchangeReply;
import tools.jackson.databind.JsonNode;

/** Existing wire fixtures enter the same decoder as real HTTP, before a database transaction. */
public final class ExchangeTestData {
    private ExchangeTestData() {}
    public static void finish(ExchangeTasks exchange,DeliveryAttempt attempt,ExchangeReply reply) {
        exchange.finish(attempt,new ExchangeProtocol().delivery(attempt,reply));
    }
    public static boolean consume(ExchangeTasks exchange,long after,JsonNode page) {
        var decoded=new ExchangeProtocol().feed(new ExchangeReply(200,page,false),after);
        if (decoded.status()!=FeedStatus.READY) throw new IllegalArgumentException("Test fixture has an invalid feed envelope");
        return exchange.consume(after,decoded.events());
    }
}
