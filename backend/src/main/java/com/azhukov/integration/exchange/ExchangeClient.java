package com.azhukov.integration.exchange;

import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.contract.external.model.OperationInput;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;

@Component
public class ExchangeClient implements AutoCloseable {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1))
        .version(HttpClient.Version.HTTP_1_1).build();
    private final URI base;
    private final ObjectMapper json;

    public ExchangeClient(ObjectMapper json, @Value("${SI_EMULATOR_URL:http://127.0.0.1:19581}") URI base) {
        if (!validOrigin(base)) throw new IllegalArgumentException("SI_EMULATOR_URL must be an absolute HTTP origin");
        this.base = base;
        this.json = json;
    }

    public ExchangeReply put(UUID id, OperationInput input) {
        return send(HttpRequest.newBuilder(base.resolve("/operations/" + id))
            .header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(input))));
    }

    public ExchangeReply get(UUID id) { return send(HttpRequest.newBuilder(base.resolve("/operations/" + id)).GET()); }
    public ExchangeReply events(long after) { return send(HttpRequest.newBuilder(base.resolve("/result-events?after=" + after + "&limit=100")).GET()); }

    private ExchangeReply send(HttpRequest.Builder request) {
        try {
            var response = http.send(request.timeout(Duration.ofSeconds(2)).header("Accept", "application/json").build(),
                HttpResponse.BodyHandlers.ofString());
            JsonNode body;
            try { body = json.readTree(response.body()); } catch (RuntimeException invalid) { body = null; }
            return new ExchangeReply(response.statusCode(), body, false);
        } catch (ConnectException | HttpConnectTimeoutException unavailable) {
            return new ExchangeReply(0, null, true);
        } catch (IOException ambiguous) {
            return new ExchangeReply(0, null, false);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Exchange interrupted", interrupted);
        }
    }

    @Override public void close() { http.close(); }

    private static boolean validOrigin(URI uri) {
            return ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) && uri.getHost() != null
                && uri.getUserInfo() == null && (uri.getPath().isEmpty() || uri.getPath().equals("/"))
                && uri.getQuery() == null && uri.getFragment() == null;
    }
}
