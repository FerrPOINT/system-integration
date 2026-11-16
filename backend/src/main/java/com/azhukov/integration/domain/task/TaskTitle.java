package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.TextRule;

/** Local title versioning is independent of the external exchange version. */
public record TaskTitle(String value, long revision) {
    public static final long MAX_REVISION = 9007199254740991L;

    public TaskTitle {
        if (!TextRule.valid(value, 160))
            throw RuleViolation.invalid(
                    "Укажите непустое название до 160 символов: корректный Unicode без нулевого символа");
        if (revision < 1 || revision > MAX_REVISION) throw RuleViolation.invalid("Достигнут предел версии");
    }

    public TaskTitle rename(String title, long expectedRevision) {
        if (revision != expectedRevision)
            throw new RuleViolation(
                    RuleViolation.Code.TITLE_REVISION_CONFLICT, "Название уже изменено. Обновите карточку");
        if (revision == MAX_REVISION) throw RuleViolation.invalid("Достигнут предел версии");
        return new TaskTitle(title, revision + 1);
    }
}
