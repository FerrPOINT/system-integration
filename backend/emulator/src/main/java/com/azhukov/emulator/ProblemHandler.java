package com.azhukov.emulator;

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

    @ExceptionHandler(EmulatorProblem.class)
    ResponseEntity<Problem> problem(EmulatorProblem problem) {
        return ResponseEntity.status(problem.status).contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(new Problem(problem.code,problem.status,Problem.CodeEnum.fromValue(problem.code)));
    }

    @ExceptionHandler({BindException.class, HttpMessageNotReadableException.class,
        HandlerMethodValidationException.class, MethodArgumentTypeMismatchException.class, jakarta.validation.ConstraintViolationException.class})
    ResponseEntity<Problem> invalid(Exception error) { return problem(new EmulatorProblem(400, "VALIDATION_FAILED")); }
}
