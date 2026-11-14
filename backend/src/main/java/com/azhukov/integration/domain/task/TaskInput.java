package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;
import java.util.regex.Pattern;

public record TaskInput(String reference, int quantity) {
    private static final Pattern REFERENCE = Pattern.compile("REQ-[0-9]{6}");
    public TaskInput {
        if (reference == null || !REFERENCE.matcher(reference).matches() || quantity < 1 || quantity > 1000)
            throw RuleViolation.invalid("Некорректный исходный запрос");
    }
}
