package com.azhukov.integration.security;

import com.azhukov.integration.domain.Actor;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;

public final class AppUser extends User {
    private final UUID id;
    private final String role;

    public AppUser(UUID id, String username, String password, String role) {
        super(username, password, List.of(new SimpleGrantedAuthority("ROLE_" + role)));
        this.id = id;
        this.role = role;
    }

    public UUID id() {
        return id;
    }

    public String role() {
        return role;
    }

    public Actor actor() {
        return new Actor(id, Actor.Role.valueOf(role));
    }

    public static AppUser current() {
        return (AppUser) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }
}
