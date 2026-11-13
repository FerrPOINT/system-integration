package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.TaskInput;
import java.util.Objects;
import java.util.UUID;

public record DeliveryAttempt(UUID operationId, UUID attemptId, String step, int number, TaskInput request) {
    public enum Outcome { ACKNOWLEDGED, NOT_FOUND, CONNECT_FAILED, TEMPORARY_FAILURE, PROTOCOL_ERROR }
    public record Decision(DeliveryStatus status, String nextStep, int delaySeconds,
                           boolean temporaryIssue, boolean uncertainHistory) {}

    public DeliveryAttempt {
        Objects.requireNonNull(operationId); Objects.requireNonNull(attemptId); Objects.requireNonNull(request);
        if ((!"PUT".equals(step) && !"GET".equals(step)) || number<1)
            throw new IllegalArgumentException("Некорректная попытка доставки");
    }

    public Decision decide(Outcome outcome) {
        return switch(outcome) {
            case ACKNOWLEDGED -> new Decision(DeliveryStatus.ACKNOWLEDGED,null,0,false,false);
            case PROTOCOL_ERROR -> new Decision(DeliveryStatus.NEEDS_REVIEW,null,0,false,false);
            case NOT_FOUND, CONNECT_FAILED, TEMPORARY_FAILURE -> {
                boolean repeatPut=outcome==Outcome.NOT_FOUND || (step.equals("PUT") && outcome==Outcome.CONNECT_FAILED);
                yield new Decision(repeatPut ? DeliveryStatus.RETRY_WAIT : DeliveryStatus.UNKNOWN,
                    repeatPut ? "PUT" : "GET",delay(number),!repeatPut || number>=4,!repeatPut);
            }
        };
    }

    public static int delay(int attempts) {
        return switch(attempts) { case 1 -> 2; case 2 -> 5; case 3 -> 15; default -> 60; };
    }
}
