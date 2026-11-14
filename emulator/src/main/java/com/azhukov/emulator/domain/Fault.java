package com.azhukov.emulator.domain;

import java.util.UUID;

public record Fault(FaultMode mode, UUID bound) {
    public Fault {
        if (mode == null || mode == FaultMode.NONE) throw new RuleViolation(RuleViolation.Code.VALIDATION_FAILED);
    }

    public FaultMode forNextAcceptance() {
        if (bound != null) return FaultMode.NONE;
        if (mode == FaultMode.UNAVAILABLE) throw new RuleViolation(RuleViolation.Code.UNAVAILABLE);
        return mode;
    }

    public boolean changeTo(FaultMode requested) {
        if (mode == requested) return false;
        if (bound != null) throw new RuleViolation(RuleViolation.Code.FAULT_ALREADY_BOUND);
        return true;
    }
}
