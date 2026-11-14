package com.azhukov.integration.domain;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/** UTC calendar range shared by API filters and accepted external timestamps. */
public final class UtcTimestamp {
    private UtcTimestamp() {}

    public static boolean isSupported(OffsetDateTime value) {
        return value.getOffset().equals(ZoneOffset.UTC) && value.getYear()>=1 && value.getYear()<=9999;
    }
}
