package com.azhukov.integration.auth;

import com.azhukov.integration.contract.internal.api.SessionApi;
import com.azhukov.integration.contract.internal.model.CsrfToken;
import com.azhukov.integration.contract.internal.model.Session;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SessionController implements SessionApi {
    private final HttpServletRequest request;

    public SessionController(HttpServletRequest request) { this.request = request; }

    @Override
    public ResponseEntity<CsrfToken> getCsrfToken() {
        var token = (org.springframework.security.web.csrf.CsrfToken)
            request.getAttribute(org.springframework.security.web.csrf.CsrfToken.class.getName());
        return ResponseEntity.ok(new CsrfToken(token.getToken()));
    }

    @Override
    public ResponseEntity<Session> getSession() {
        var user = AppUser.current();
        return ResponseEntity.ok(new Session(user.id(), user.getUsername(), Session.RoleEnum.fromValue(user.role())));
    }
}
