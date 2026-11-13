package com.azhukov.emulator.web;

import com.azhukov.emulator.domain.RuleViolation;

import com.azhukov.integration.contract.external.model.Problem;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
class ProblemHandler {

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
        HandlerMethodValidationException.class, MethodArgumentTypeMismatchException.class, jakarta.validation.ConstraintViolationException.class})
    ResponseEntity<Problem> invalid(Exception error) { return problem(new RuleViolation(RuleViolation.Code.VALIDATION_FAILED)); }
}
