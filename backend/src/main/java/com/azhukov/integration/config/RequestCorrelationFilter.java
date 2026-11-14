package com.azhukov.integration.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Request-local correlation, including Security errors; caller-supplied IDs are never trusted. */
@Component
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestCorrelationFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
        throws ServletException,IOException {
        String id=UUID.randomUUID().toString();
        response.setHeader("X-Request-ID",id);
        try (var correlation=MDC.putCloseable("requestId",id)) {
            try { chain.doFilter(request,response); }
            catch (IOException | ServletException | RuntimeException failure) {
                // Exception messages may contain database values: keep only identity/category.
                log.error("http failure method={} path={} exception={}",request.getMethod(),request.getRequestURI(),failure.getClass().getSimpleName());
                throw failure;
            }
            if (response.getStatus()>=400)
                log.warn("http rejected method={} path={} status={}",request.getMethod(),request.getRequestURI(),response.getStatus());
        }
    }
}
