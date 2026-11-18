package com.azhukov.emulator.domain;

public record OperationRequest(int quantity) {
    public OperationRequest {
        if (quantity < 1 || quantity > 1000) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
    }
}
