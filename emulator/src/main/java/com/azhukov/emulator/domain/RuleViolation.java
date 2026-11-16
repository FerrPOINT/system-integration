package com.azhukov.emulator.domain;

public final class RuleViolation extends RuntimeException {
    public enum Code {
        VALIDATION_FAILED,
        OPERATION_NOT_FOUND,
        OPERATION_CONFLICT,
        FAULT_ALREADY_BOUND,
        UNAVAILABLE
    }

    private final Code code;

    public RuleViolation(Code code) {
        super(code.name());
        this.code = code;
    }

    public Code code() {
        return code;
    }
}
