package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;

public record TaskInput(int quantity) {
    public TaskInput {
        if (quantity < 1 || quantity > 1000) throw RuleViolation.invalid("Количество должно быть от 1 до 1000");
    }
}
