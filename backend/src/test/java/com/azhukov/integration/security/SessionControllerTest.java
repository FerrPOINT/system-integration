package com.azhukov.integration.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.azhukov.integration.controller.SessionController;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.DefaultCsrfToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

class SessionControllerTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final MockMvc mvc;

    SessionControllerTest() {
        var request = new MockHttpServletRequest();
        request.setAttribute(CsrfToken.class.getName(), new DefaultCsrfToken("X-CSRF-TOKEN", "_csrf", "fixture"));
        mvc = MockMvcBuilders.standaloneSetup(new SessionController(request)).build();
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void anonymousTokenHasNoAuthenticatedOwner() throws Exception {
        var response = mvc.perform(get("/api/csrf")).andReturn().getResponse();
        assertEquals(200, response.getStatus());
        var body = json.readTree(response.getContentAsString());
        assertEquals("fixture", body.get("token").asString());
        assertFalse(body.hasNonNull("userId"));
    }

    @Test
    void tokenReportsTheCurrentPrincipalAcrossIdentityChanges() throws Exception {
        for (var id :
                List.of(
                        UUID.fromString("00000000-0000-4000-8000-000000000001"),
                        UUID.fromString("00000000-0000-4000-8000-000000000002"))) {
            var user = new AppUser(id, "fixture", "unused", "INITIATOR");
            SecurityContextHolder.getContext()
                    .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
            var response = mvc.perform(get("/api/csrf")).andReturn().getResponse();
            assertEquals(200, response.getStatus());
            var body = json.readTree(response.getContentAsString());
            assertEquals("fixture", body.get("token").asString());
            assertEquals(id.toString(), body.get("userId").asString());
        }
    }
}
