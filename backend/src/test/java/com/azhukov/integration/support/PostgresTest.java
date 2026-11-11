package com.azhukov.integration.support;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Tag("postgres")
@SpringBootTest(properties = "si.exchange.enabled=false")
@AutoConfigureMockMvc
public abstract class PostgresTest {
    @Autowired protected MockMvc mvc;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected ObjectMapper json;
    @Autowired protected PasswordEncoder passwords;

    protected final UUID first = UUID.fromString("00000000-0000-4000-8000-000000000001");
    protected final UUID second = UUID.fromString("00000000-0000-4000-8000-000000000002");
    protected final UUID operator = UUID.fromString("00000000-0000-4000-8000-000000000003");
    protected static final String PASSWORD = "test-only-password-123";
    protected static final String CREATE = """
        {"title":"Проверка заявки", "request":{"reference":"REQ-000001","quantity":25}}
        """;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:postgresql://127.0.0.1:19532/si_test");
        registry.add("spring.datasource.username", () -> "si_test");
        registry.add("spring.datasource.password", () -> System.getenv("SI_TEST_DB_PASSWORD"));
    }

    @BeforeEach
    protected void users() {
        assertEquals("si_test", jdbc.queryForObject("SELECT current_database()", String.class));
        jdbc.execute("TRUNCATE task_history,delivery_queue,command_receipts,tasks,users CASCADE");
        jdbc.update("UPDATE incoming_position SET last_cursor = 0 WHERE id = 1");
        String hash = passwords.encode(PASSWORD);
        jdbc.update("INSERT INTO users VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)",
            first, "initiator.one", hash, "INITIATOR", second, "initiator.two", hash, "INITIATOR",
            operator, "operator", hash, "OPERATOR");
    }

    protected Client login(String username) throws Exception {
        var csrf = mvc.perform(get("/api/csrf")).andReturn();
        var session = (MockHttpSession) csrf.getRequest().getSession();
        var result = mvc.perform(post("/api/login").session(session)
            .header("X-CSRF-TOKEN", body(csrf).get("token").asString())
            .param("username", username).param("password", PASSWORD)).andReturn();
        status(204, result);
        session = (MockHttpSession) result.getRequest().getSession();
        var refreshed = mvc.perform(get("/api/csrf").session(session)).andReturn();
        return new Client(session, body(refreshed).get("token").asString());
    }

    protected MvcResult create(Client client, UUID key, String input) throws Exception {
        return mvc.perform(post("/api/tasks").session(client.session()).header("X-CSRF-TOKEN", client.csrf())
            .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON).content(input)).andReturn();
    }

    protected UUID created(Client client, UUID key) throws Exception {
        var result = create(client, key, CREATE);
        status(201, result);
        return UUID.fromString(body(result).get("taskId").asString());
    }

    protected MvcResult rename(Client client, UUID id, UUID key, String title, long revision) throws Exception {
        return mvc.perform(patch("/api/tasks/" + id).session(client.session()).header("X-CSRF-TOKEN", client.csrf())
            .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(java.util.Map.of("title", title, "expectedTitleRevision", revision)))).andReturn();
    }

    protected JsonNode body(MvcResult result) throws Exception { return json.readTree(result.getResponse().getContentAsString()); }
    protected void status(int expected, MvcResult result) throws Exception {
        assertEquals(expected, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    }
    protected int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    protected record Client(MockHttpSession session, String csrf) {}
}
