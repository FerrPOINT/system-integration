package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.TaskInput;
import java.util.Objects;
import java.util.UUID;

public record DeliveryAttempt(UUID operationId, UUID attemptId, String step, int number, int automaticNumber, TaskInput request) {
    public static final int MAX_AUTOMATIC_ATTEMPTS = 5;

    public enum Outcome { ACKNOWLEDGED, NOT_FOUND, CONNECT_FAILED, TEMPORARY_FAILURE, PROTOCOL_ERROR }
    public record Decision(DeliveryStatus status, String nextStep, int delaySeconds,
                           boolean temporaryIssue, boolean uncertainHistory, boolean limitReached) {}

    public DeliveryAttempt {
        Objects.requireNonNull(operationId); Objects.requireNonNull(attemptId); Objects.requireNonNull(request);
        if ((!"PUT".equals(step) && !"GET".equals(step)) || number<1 || automaticNumber<1 || automaticNumber>number)
            throw new IllegalArgumentException("Некорректная попытка доставки");
    }

    public Decision decide(Outcome outcome) {
        return switch(outcome) {
            case ACKNOWLEDGED -> new Decision(DeliveryStatus.ACKNOWLEDGED,null,0,false,false,false);
            case PROTOCOL_ERROR -> new Decision(DeliveryStatus.NEEDS_REVIEW,null,0,false,false,false);
            case NOT_FOUND, CONNECT_FAILED, TEMPORARY_FAILURE -> {
                boolean repeatPut=outcome==Outcome.NOT_FOUND || (step.equals("PUT") && outcome==Outcome.CONNECT_FAILED);
                if (exhausted(automaticNumber))
                    yield new Decision(DeliveryStatus.NEEDS_REVIEW,null,0,true,!repeatPut,true);
                yield new Decision(repeatPut ? DeliveryStatus.RETRY_WAIT : DeliveryStatus.UNKNOWN,
                    repeatPut ? "PUT" : "GET",delay(automaticNumber),!repeatPut,!repeatPut,false);
            }
        };
    }

    public static boolean exhausted(int automaticAttempts) {
        return automaticAttempts >= MAX_AUTOMATIC_ATTEMPTS;
    }

    public static int delay(int attempts) {
        return switch(attempts) { case 1 -> 2; case 2 -> 5; case 3 -> 15; default -> 60; };
    }
}
