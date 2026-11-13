package com.azhukov.integration.support;

import com.azhukov.integration.client.ExternalExchangeClient.FeedStatus;
import com.azhukov.integration.client.http.ExchangeProtocol;
import com.azhukov.integration.client.http.ExchangeReply;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.service.ExchangeService;
import tools.jackson.databind.JsonNode;

/** Existing wire fixtures enter the same decoder as real HTTP, before a database transaction. */
public final class ExchangeTestData {
    private ExchangeTestData() {}
    public static void finish(ExchangeService exchange,DeliveryAttempt attempt,ExchangeReply reply) {
        exchange.finish(attempt,new ExchangeProtocol().delivery(attempt,reply));
    }
    public static boolean consume(ExchangeService exchange,long after,JsonNode page) {
        var decoded=new ExchangeProtocol().feed(new ExchangeReply(200,page,false),after);
        if (decoded.status()!=FeedStatus.READY) throw new IllegalArgumentException("Test fixture has an invalid feed envelope");
        return exchange.consume(after,decoded.events());
    }
}
