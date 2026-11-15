package com.azhukov.integration.dto.exchange;

import com.azhukov.integration.domain.exchange.DeliveryAttempt;

/** A candidate changed/was maintained is different from finding no candidate at all. */
public record ClaimResult(Outcome outcome, DeliveryAttempt attempt) {
    public enum Outcome {
        CLAIMED,
        SKIPPED,
        EMPTY
    }

    public ClaimResult {
        if (outcome == null || (outcome == Outcome.CLAIMED) != (attempt != null))
            throw new IllegalArgumentException("Claim outcome and attempt disagree");
    }

    public static ClaimResult claimed(DeliveryAttempt attempt) {
        return new ClaimResult(Outcome.CLAIMED, attempt);
    }

    public static ClaimResult skipped() {
        return new ClaimResult(Outcome.SKIPPED, null);
    }

    public static ClaimResult empty() {
        return new ClaimResult(Outcome.EMPTY, null);
    }
}
