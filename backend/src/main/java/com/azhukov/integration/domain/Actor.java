package com.azhukov.integration.domain;

import java.util.Objects;
import java.util.UUID;

/** The authenticated identity needed by use cases, without a session or credentials. */
public record Actor(UUID id, Role role) {
    public enum Role {
        INITIATOR,
        OPERATOR
    }

    public Actor {
        Objects.requireNonNull(id);
        Objects.requireNonNull(role);
    }

    public boolean isOperator() {
        return role == Role.OPERATOR;
    }
}
