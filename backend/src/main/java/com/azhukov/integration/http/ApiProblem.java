package com.azhukov.integration.http;

public final class ApiProblem extends RuntimeException {
    private final int status;
    private final String code;

    public ApiProblem(int status, String code, String detail) {
        super(detail);
        this.status = status;
        this.code = code;
    }

    public int status() { return status; }
    public String code() { return code; }

    public static ApiProblem notFound() {
        return new ApiProblem(404, "NOT_FOUND", "Запись не найдена");
    }

    public static ApiProblem invalid(String detail) {
        return new ApiProblem(400, "VALIDATION_FAILED", detail);
    }
}
