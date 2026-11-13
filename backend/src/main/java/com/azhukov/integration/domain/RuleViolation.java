package com.azhukov.integration.domain;

/** A rejected operation; the HTTP adapter owns its transport representation. */
public final class RuleViolation extends RuntimeException {
    public enum Code {
        VALIDATION_FAILED, NOT_FOUND, ACCESS_DENIED, IDEMPOTENCY_CONFLICT,
        TITLE_REVISION_CONFLICT, ISSUE_REVISION_CONFLICT, SNAPSHOT_STALE, ACTION_NOT_ALLOWED
    }

    private final Code code;

    public RuleViolation(Code code, String detail) {
        super(detail);
        this.code = java.util.Objects.requireNonNull(code);
    }

    public Code code() { return code; }

    public static RuleViolation notFound() {
        return new RuleViolation(Code.NOT_FOUND, "Запись не найдена");
    }

    public static RuleViolation invalid(String detail) {
        return new RuleViolation(Code.VALIDATION_FAILED, detail);
    }
}
