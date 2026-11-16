package com.azhukov.integration.domain;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/** Persisted command text: Unicode code points, Unicode White_Space, no NUL or malformed UTF-16. */
public final class TextRule {
    private static final Pattern NON_BLANK =
            Pattern.compile(
                    "[^\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]");

    private TextRule() {}

    public static boolean valid(String value, int maxCodePoints) {
        return value != null
                && value.codePointCount(0, value.length()) <= maxCodePoints
                && value.indexOf(0) < 0
                && StandardCharsets.UTF_8.newEncoder().canEncode(value)
                && NON_BLANK.matcher(value).find();
    }
}
