package com.azhukov.integration.client.http;

import com.azhukov.integration.client.ExternalExchangeClient;
import com.azhukov.integration.config.ExchangeHttpProperties;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.review.Reconciliation.Availability;
import com.azhukov.integration.domain.task.TaskInput;
import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Uses a Spring-owned HttpClient with a deadline covering headers and the full body.
 * Oversize is a typed protocol outcome. Ambiguous PUT outcomes require lookup of
 * the same operation, never creation of a new execution identity.
 */
@Component
public class HttpExternalExchangeClient implements ExternalExchangeClient {
    private final HttpClient http;
    private final ExchangeHttpProperties settings;
    private final URI base;
    private final ObjectMapper json;

    public HttpExternalExchangeClient(HttpClient http, ObjectMapper json, ExchangeHttpProperties settings) {
        this.http = http;
        this.settings = settings;
        this.base = settings.baseUrl();
        this.json = json;
    }

    public ExchangeReply put(UUID id, TaskInput input) {
        return send(HttpRequest.newBuilder(base.resolve("/operations/" + id))
            .header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(input))));
    }

    public ExchangeReply get(UUID id) { return send(HttpRequest.newBuilder(base.resolve("/operations/" + id)).GET()); }
    @Override
    public FeedReply events(long after) {
        var reply=send(HttpRequest.newBuilder(base.resolve("/result-events?after="+after+"&limit=100")).GET());
        return new ExchangeProtocol().feed(reply,after);
    }

    @Override
    public DeliveryReply deliver(DeliveryAttempt attempt) {
        var reply=attempt.step().equals("PUT") ? put(attempt.operationId(),attempt.request()) : get(attempt.operationId());
        return new ExchangeProtocol().delivery(attempt,reply);
    }

    @Override
    public Lookup lookup(UUID id) {
        var reply=get(id);
        if (reply.protocolFailure()!=null)
            return new Lookup(Availability.UNAVAILABLE,null,reply.protocolFailure(),
                new ProtocolEvidence(null,"RESPONSE_SIZE at body"));
        if (ExchangeProtocol.missingOperation(reply.status(),reply.body()))
            return new Lookup(Availability.NOT_FOUND,null,null,reply.body());
        if (reply.status()>=400 && reply.status()<500)
            return new Lookup(Availability.UNAVAILABLE,null,
                "Сверка получила некорректный постоянный ответ HTTP "+reply.status(),reply.body());
        if (reply.status()==200) {
            try { return new Lookup(Availability.PRESENT,new ExchangeProtocol().state(reply.body()),null,reply.body()); }
            catch (IllegalArgumentException invalid) {
                return new Lookup(Availability.UNAVAILABLE,null,"Сверка получила некорректный внешний снимок",
                    ExchangeProtocol.diagnostics(reply.body(),invalid));
            }
        }
        return new Lookup(Availability.UNAVAILABLE,null,null,reply.body());
    }

    private ExchangeReply send(HttpRequest.Builder request) {
        var pending = http.sendAsync(
            request.timeout(settings.responseTimeout()).header("Accept", "application/json").build(),
            BoundedResponseBody.handler(settings.maxResponseSize().toBytes()));
        try {
            // Java 25 request.timeout covers headers only; bound the complete body as well.
            var response = pending.get(settings.responseTimeout().toNanos(), TimeUnit.NANOSECONDS);
            JsonNode body;
            try { body = json.readTree(response.body()); } catch (RuntimeException invalid) { body = null; }
            return new ExchangeReply(response.statusCode(), body, false,null);
        } catch (TimeoutException ambiguous) {
            pending.cancel(true);
            return new ExchangeReply(0, null, false,null);
        } catch (ExecutionException failed) {
            var cause = failed.getCause();
            if (cause instanceof BoundedResponseBody.TooLarge oversized)
                return new ExchangeReply(oversized.status(),null,false,oversized.getMessage());
            if (cause instanceof ConnectException || cause instanceof HttpConnectTimeoutException)
                return new ExchangeReply(0, null, true,null);
            if (cause instanceof IOException) return new ExchangeReply(0, null, false,null);
            throw new IllegalStateException("Exchange request failed", cause);
        } catch (InterruptedException interrupted) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Exchange interrupted", interrupted);
        }
    }

}
