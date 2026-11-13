package com.azhukov.emulator.domain;

import java.util.regex.Pattern;

public record OperationRequest(String reference,int quantity) {
    private static final Pattern REFERENCE=Pattern.compile("REQ-[0-9]{6}");
    public OperationRequest {
        if (reference==null || !REFERENCE.matcher(reference).matches() || quantity<1 || quantity>1000)
            throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
    }
}
