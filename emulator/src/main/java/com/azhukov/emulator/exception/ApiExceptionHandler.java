package com.azhukov.emulator.exception;

import com.azhukov.emulator.domain.RuleViolation;
import com.azhukov.integration.contract.external.model.Problem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.MissingRequestValueException;
import org.springframework.http.ProblemDetail;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
@Slf4j
class ApiExceptionHandler {

    @ExceptionHandler(RuleViolation.class)
    ResponseEntity<Problem> problem(RuleViolation problem) {
        int status=switch(problem.code()) {
            case VALIDATION_FAILED -> 400;
            case OPERATION_NOT_FOUND -> 404;
            case OPERATION_CONFLICT, FAULT_ALREADY_BOUND -> 409;
            case UNAVAILABLE -> 503;
        };
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(new Problem(problem.code().name(),status,Problem.CodeEnum.fromValue(problem.code().name())));
    }

    @ExceptionHandler({BindException.class, HttpMessageNotReadableException.class,
        MissingRequestValueException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<Problem> invalid(Exception error) { return problem(new RuleViolation(RuleViolation.Code.VALIDATION_FAILED)); }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<?> methodValidation(HandlerMethodValidationException error) {
        if (!error.isForReturnValue()) return invalid(error);
        log.error("Controller response violates validation constraints");
        return ResponseEntity.internalServerError().contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(ProblemDetail.forStatus(500));
    }

    @ExceptionHandler({CannotCreateTransactionException.class, DataAccessResourceFailureException.class})
    ResponseEntity<Problem> unavailable(Exception error) {
        log.warn("Emulator database unavailable exception={}",error.getClass().getSimpleName());
        return problem(new RuleViolation(RuleViolation.Code.UNAVAILABLE));
    }
}
