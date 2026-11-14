package com.azhukov.integration.security;

import com.azhukov.integration.support.PostgresTest;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="si.exchange.enabled=false")
class HttpErrorRoutingTest extends PostgresTest {
    @LocalServerPort int port;

    @Test
    void internalErrorDispatchPreservesHttpStatusWithoutOpeningTheErrorEndpoint() throws Exception {
        try (var client=client()) {
            String csrf=signIn(client,"initiator.one");
            var created=request(client,"POST","/api/tasks",CREATE,csrf,UUID.randomUUID());
            assertEquals(201,created.statusCode());
            String task=json.readTree(created.body()).get("taskId").asString();
            assertEquals(405,request(client,"DELETE","/api/tasks/"+task,null,csrf,null).statusCode());
            assertEquals(404,request(client,"GET","/api/not-a-route",null,null,null).statusCode());
            assertEquals(403,request(client,"GET","/error",null,null,null).statusCode());
            assertEquals(200,request(client,"GET","/api/tasks/"+task,null,null,null).statusCode());
        }
        try (var operator=client();var anonymous=client()) {
            String csrf=signIn(operator,"operator");
            assertEquals(403,request(operator,"POST","/api/tasks",CREATE,csrf,UUID.randomUUID()).statusCode());
            assertEquals(401,request(anonymous,"GET","/api/tasks",null,null,null).statusCode());
        }
        assertEquals(1,count("tasks"));
    }

    @Test
    void anUnexpectedDatabaseFailureIs500WithRollbackAndNoInternalDetails() throws Exception {
        jdbc.execute("""
            CREATE FUNCTION test_http_enqueue_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'Private test database diagnostic'; END; $$
            """);
        jdbc.execute("CREATE TRIGGER test_http_enqueue_failure BEFORE INSERT ON delivery_queue FOR EACH ROW EXECUTE FUNCTION test_http_enqueue_failure()");
        UUID key=UUID.randomUUID();
        try (var client=client()) {
            String csrf=signIn(client,"initiator.one");
            try {
                var failed=request(client,"POST","/api/tasks",CREATE,csrf,key);
                assertEquals(500,failed.statusCode());
                assertFalse(failed.body().contains("Private test database diagnostic"));
                assertFalse(failed.body().contains("UncategorizedSQLException"));
                assertEquals(0,count("tasks"));
                assertEquals(0,count("delivery_queue"));
                assertEquals(0,count("command_receipts"));
                assertEquals(0,count("task_history"));
            } finally {
                jdbc.execute("DROP TRIGGER test_http_enqueue_failure ON delivery_queue");
                jdbc.execute("DROP FUNCTION test_http_enqueue_failure()");
            }
            var recovered=request(client,"POST","/api/tasks",CREATE,csrf,key);
            assertEquals(201,recovered.statusCode());
            assertEquals(recovered.body(),request(client,"POST","/api/tasks",CREATE,csrf,key).body());
            assertEquals(1,count("tasks"));
        }
    }

    private HttpClient client() {
        return HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL))
            .connectTimeout(Duration.ofSeconds(2)).build();
    }

    private String signIn(HttpClient client,String username) throws Exception {
        String csrf=json.readTree(request(client,"GET","/api/csrf",null,null,null).body()).get("token").asString();
        var login=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/login"))
            .timeout(Duration.ofSeconds(5)).header("X-CSRF-TOKEN",csrf)
            .header("Content-Type","application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString("username="+username+"&password="+PASSWORD)).build();
        assertEquals(204,client.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
        return json.readTree(request(client,"GET","/api/csrf",null,null,null).body()).get("token").asString();
    }

    private HttpResponse<String> request(HttpClient client,String method,String path,String body,String csrf,UUID key) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(5));
        if (csrf!=null) builder.header("X-CSRF-TOKEN",csrf);
        if (key!=null) builder.header("Idempotency-Key",key.toString());
        if (body!=null) builder.header("Content-Type","application/json");
        return client.send(builder.method(method,body==null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString());
    }
}
