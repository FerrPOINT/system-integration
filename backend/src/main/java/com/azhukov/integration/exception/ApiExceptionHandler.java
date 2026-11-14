package com.azhukov.integration.exception;

import com.azhukov.integration.contract.internal.model.Problem;
import com.azhukov.integration.domain.RuleViolation;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MissingRequestValueException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import tools.jackson.databind.ObjectMapper;

@RestControllerAdvice
@RequiredArgsConstructor
@Slf4j
public class ApiExceptionHandler {
    private final ObjectMapper json;

    @ExceptionHandler(RuleViolation.class)
    ResponseEntity<Problem> handle(RuleViolation error) {
        int status = switch (error.code()) {
            case VALIDATION_FAILED -> 400;
            case NOT_FOUND -> 404;
            case ACCESS_DENIED -> 403;
            case IDEMPOTENCY_CONFLICT, TITLE_REVISION_CONFLICT, ISSUE_REVISION_CONFLICT,
                 SNAPSHOT_STALE, ACTION_NOT_ALLOWED -> 409;
        };
        return response(status,error.code().name(),error.getMessage());
    }

    private ResponseEntity<Problem> response(int status,String code,String detail) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(new Problem(code,status,Problem.CodeEnum.fromValue(code)).detail(detail));
    }

    @ExceptionHandler({CannotCreateTransactionException.class, DataAccessResourceFailureException.class})
    ResponseEntity<Problem> unavailable(Exception error, HttpServletRequest request) {
        log.warn("database unavailable method={} path={} exception={}",
            request.getMethod(),request.getRequestURI(),error.getClass().getSimpleName());
        return response(503,"SERVICE_UNAVAILABLE","Хранилище временно недоступно. Повторите действие позже");
    }

    @ExceptionHandler({BindException.class, HandlerMethodValidationException.class, jakarta.validation.ConstraintViolationException.class,
        HttpMessageNotReadableException.class, MissingRequestValueException.class,
        MethodArgumentTypeMismatchException.class})
    ResponseEntity<Problem> validation(Exception error) {
        return response(400,"VALIDATION_FAILED","Проверьте поля запроса");
    }

    public void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        json.writeValue(response.getOutputStream(),new Problem(code,status,Problem.CodeEnum.fromValue(code)).detail(code));
    }
}
