package com.azhukov.integration.config;

import jakarta.servlet.ServletException;
import java.util.HashSet;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.*;

class RequestCorrelationFilterTest {
    @Test
    void createsIndependentServerIdsAndClearsContextAfterEachRequest() throws Exception {
        var ids=new HashSet<String>();
        var filter=new RequestCorrelationFilter();
        for (int n=0;n<2;n++) {
            var request=new MockHttpServletRequest();
            request.addHeader("X-Request-ID","caller-controlled");
            var response=new MockHttpServletResponse();
            filter.doFilter(request,response,(req,res) -> {
                var id=response.getHeader("X-Request-ID");
                assertNotNull(UUID.fromString(id));
                assertEquals(id,MDC.get("requestId"));ids.add(id);
            });
            assertNull(MDC.get("requestId"));
        }
        assertEquals(2,ids.size());
    }

    @Test
    void errorsKeepTheResponseIdWithoutLeakingContext() {
        var response=new MockHttpServletResponse();
        assertThrows(ServletException.class,() -> new RequestCorrelationFilter().doFilter(
            new MockHttpServletRequest(),response,(req,res) -> { throw new ServletException("synthetic"); }));
        assertNotNull(response.getHeader("X-Request-ID"));
        assertNull(MDC.get("requestId"));
    }
}
