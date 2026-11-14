package com.azhukov.integration.security;

import com.azhukov.integration.support.PostgresTest;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class AuthenticationFailureTest extends PostgresTest {
    @MockitoBean(enforceOverride = true)
    private UserDetailsService userDetails;

    @Test
    void lookupFailureIsUnavailableWhileInvalidPasswordRemainsUnauthorized() throws Exception {
        String hash = jdbc.queryForObject("SELECT password_hash FROM users WHERE id = ?", String.class, first);
        when(userDetails.loadUserByUsername("initiator.one"))
            .thenReturn(new AppUser(first, "initiator.one", hash, "INITIATOR"));
        when(userDetails.loadUserByUsername("outage"))
            .thenThrow(new DataAccessResourceFailureException("private database diagnostic"));
        var csrf = mvc.perform(get("/api/csrf")).andReturn();
        var session = (MockHttpSession) csrf.getRequest().getSession();
        String token = body(csrf).get("token").asString();
        var unavailable = mvc.perform(post("/api/login").session(session).header("X-CSRF-TOKEN", token)
            .param("username", "outage").param("password", PASSWORD)).andReturn();
        status(503, unavailable);
        assertEquals("SERVICE_UNAVAILABLE", body(unavailable).get("code").asString());
        assertFalse(unavailable.getResponse().getContentAsString().contains("private database diagnostic"));
        status(401, mvc.perform(post("/api/login").session(session).header("X-CSRF-TOKEN", token)
            .param("username", "initiator.one").param("password", "incorrect")).andReturn());
        assertNotNull(login("initiator.one").session());
    }
}
