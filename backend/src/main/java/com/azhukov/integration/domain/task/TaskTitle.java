package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;

/** Local title versioning is independent of the external exchange version. */
public record TaskTitle(String value, long revision) {
    public static final long MAX_REVISION = 9007199254740991L;

    public TaskTitle {
        if (value == null || value.length() > 160 || !value.matches("(?s).*\\S.*"))
            throw RuleViolation.invalid("Название должно содержать от 1 до 160 символов и не быть пустым");
        if (revision < 1 || revision > MAX_REVISION)
            throw RuleViolation.invalid("Достигнут предел версии");
    }

    public TaskTitle rename(String title, long expectedRevision) {
        if (revision != expectedRevision)
            throw new RuleViolation(RuleViolation.Code.TITLE_REVISION_CONFLICT,
                "Название уже изменено. Обновите карточку");
        if (revision == MAX_REVISION) throw RuleViolation.invalid("Достигнут предел версии");
        return new TaskTitle(title, revision + 1);
    }
}
