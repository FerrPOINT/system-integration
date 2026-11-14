package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;
import java.util.regex.Pattern;

/** Local title versioning is independent of the external exchange version. */
public record TaskTitle(String value, long revision) {
    public static final long MAX_REVISION = 9007199254740991L;
    private static final Pattern NON_BLANK = Pattern.compile("\\S", Pattern.UNICODE_CHARACTER_CLASS);

    public TaskTitle {
        if (value == null || value.length() > 160 || value.indexOf(0) >= 0 || !NON_BLANK.matcher(value).find())
            throw RuleViolation.invalid(
                    "Название должно содержать от 1 до 160 символов, не быть пустым и не содержать нулевой символ");
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
