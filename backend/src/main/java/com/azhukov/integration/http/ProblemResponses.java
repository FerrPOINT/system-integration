package com.azhukov.integration.http;

import com.azhukov.integration.contract.internal.model.Problem;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingRequestValueException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestControllerAdvice
public class ProblemResponses {
    private static final Logger log = LoggerFactory.getLogger(ProblemResponses.class);
    private final ObjectMapper json;

    public ProblemResponses(ObjectMapper json) { this.json = json; }

    @ExceptionHandler(ApiProblem.class)
    ResponseEntity<Problem> handle(ApiProblem error) {
        return ResponseEntity.status(error.status()).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(new Problem(error.code(),error.status(),Problem.CodeEnum.fromValue(error.code())).detail(error.getMessage()));
    }

    @ExceptionHandler({CannotCreateTransactionException.class, DataAccessResourceFailureException.class})
    ResponseEntity<Problem> unavailable(Exception error, HttpServletRequest request) {
        log.warn("database unavailable method={} path={} exception={}",
            request.getMethod(),request.getRequestURI(),error.getClass().getSimpleName());
        return handle(new ApiProblem(503,"SERVICE_UNAVAILABLE","Хранилище временно недоступно. Повторите действие позже"));
    }

    @ExceptionHandler({BindException.class, HandlerMethodValidationException.class, jakarta.validation.ConstraintViolationException.class,
        HttpMessageNotReadableException.class, MissingRequestValueException.class,
        MethodArgumentTypeMismatchException.class})
    ResponseEntity<Problem> validation(Exception error) {
        return handle(ApiProblem.invalid("Проверьте поля запроса"));
    }

    public void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        json.writeValue(response.getOutputStream(),new Problem(code,status,Problem.CodeEnum.fromValue(code)).detail(code));
    }
}
