package com.azhukov.emulator.exception;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import jakarta.validation.constraints.Min;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;

class ApiExceptionHandlerTest {
    @RestController
    static class ValidationFixture {
        @GetMapping("/validation/input")
        int input(@RequestParam("value") @Min(1) int value) {
            return value;
        }

        @GetMapping("/validation/output")
        @Min(1)
        int output() {
            return 0;
        }
    }

    @Test
    void inputViolationIs400ButAnInvalidControllerResponseIs500() throws Exception {
        var mvc =
                MockMvcBuilders.standaloneSetup(new ValidationFixture())
                        .setControllerAdvice(new ApiExceptionHandler())
                        .build();
        var invalid = mvc.perform(get("/validation/input?value=0")).andReturn().getResponse();
        assertEquals(400, invalid.getStatus());
        assertTrue(invalid.getContentType().startsWith(MediaType.APPLICATION_PROBLEM_JSON_VALUE));
        assertTrue(invalid.getContentAsString().contains("VALIDATION_FAILED"));
        assertEquals(200, mvc.perform(get("/validation/input?value=1")).andReturn().getResponse().getStatus());
        var broken = mvc.perform(get("/validation/output")).andReturn().getResponse();
        assertEquals(500, broken.getStatus());
        assertFalse(broken.getContentAsString().contains("VALIDATION_FAILED"));
        assertFalse(broken.getContentAsString().contains("ValidationFixture"));
    }
}
