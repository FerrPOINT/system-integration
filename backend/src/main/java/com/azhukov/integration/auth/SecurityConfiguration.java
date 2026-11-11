package com.azhukov.integration.auth;

import com.azhukov.integration.http.ProblemResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Locale;
import java.util.UUID;

@Configuration
public class SecurityConfiguration {
    @Bean
    PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

    @Bean
    UserDetailsService userDetailsService(JdbcTemplate jdbc) {
        return username -> jdbc.query("SELECT * FROM users WHERE username = ?", (rs, row) ->
            new AppUser(rs.getObject("id", UUID.class), rs.getString("username"),
                rs.getString("password_hash"), rs.getString("role")), username.toLowerCase(Locale.ROOT))
            .stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Unknown user"));
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, ProblemResponses problems) throws Exception {
        // Authentication precedes CSRF so an expired session consistently returns 401.
        http.addFilterBefore(new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                            FilterChain chain) throws ServletException, IOException {
                var path = request.getRequestURI().substring(request.getContextPath().length());
                var authentication = SecurityContextHolder.getContext().getAuthentication();
                if (path.startsWith("/api/") && !path.equals("/api/csrf") && !path.equals("/api/login")
                    && (authentication == null || !(authentication.getPrincipal() instanceof AppUser))) {
                    problems.write(response, 401, "SESSION_REQUIRED");
                    return;
                }
                chain.doFilter(request, response);
            }
        }, CsrfFilter.class);
        http.authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/csrf", "/api/login", "/actuator/health/**").permitAll()
            .requestMatchers(HttpMethod.POST, "/api/tasks").hasRole("INITIATOR")
            .requestMatchers(HttpMethod.PATCH, "/api/tasks/*").hasRole("INITIATOR")
            .requestMatchers("/api/exchange/**", "/api/tasks/*/reconciliations/**").hasRole("OPERATOR")
            .requestMatchers("/api/**").authenticated()
            .anyRequest().denyAll());
        http.formLogin(form -> form.loginProcessingUrl("/api/login")
            .successHandler((req, res, auth) -> res.setStatus(204))
            .failureHandler((req, res, error) -> problems.write(res, 401, "INVALID_CREDENTIALS")));
        http.logout(logout -> logout.logoutUrl("/api/logout")
            .deleteCookies("JSESSIONID")
            .logoutSuccessHandler((req, res, auth) -> res.setStatus(204)));
        http.exceptionHandling(errors -> errors
            .authenticationEntryPoint((req, res, error) -> problems.write(res, 401, "SESSION_REQUIRED"))
            .accessDeniedHandler((req, res, error) -> problems.write(res, 403,
                error instanceof CsrfException ? "CSRF_INVALID" : "ACCESS_DENIED")));
        http.requestCache(cache -> cache.disable());
        return http.build();
    }
}
