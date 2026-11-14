package com.azhukov.integration.repository.jdbc;

import com.azhukov.integration.security.AppUser;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Repository;

/** Uses Spring Security's existing storage boundary; no second authentication abstraction. */
@Repository
@RequiredArgsConstructor
public class JdbcUserDetailsService implements UserDetailsService {
    private final JdbcTemplate jdbc;

    @Override
    public AppUser loadUserByUsername(String username) {
        return jdbc
                .query(
                        "SELECT * FROM users WHERE username = ?",
                        (rs, row) ->
                                new AppUser(
                                        rs.getObject("id", UUID.class),
                                        rs.getString("username"),
                                        rs.getString("password_hash"),
                                        rs.getString("role")),
                        username.toLowerCase(Locale.ROOT))
                .stream()
                .findFirst()
                .orElseThrow(() -> new UsernameNotFoundException("Unknown user"));
    }
}
