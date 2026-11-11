package com.azhukov.integration.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Component
@Profile("demo-users")
public class DemoUsers implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final String password;

    public DemoUsers(JdbcTemplate jdbc, PasswordEncoder passwords, @Value("${SI_DEMO_PASSWORD}") String password) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.password = password;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (password.length() < 12) throw new IllegalArgumentException("SI_DEMO_PASSWORD must contain at least 12 characters");
        for (String username : new String[]{"initiator.one", "initiator.two", "operator"}) {
            jdbc.update("INSERT INTO users (id,username,password_hash,role) VALUES (?,?,?,?) ON CONFLICT (username) DO NOTHING",
                UUID.randomUUID(), username, passwords.encode(password),
                username.equals("operator") ? "OPERATOR" : "INITIATOR");
        }
    }
}
