package com.azhukov.integration.dto.review;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.review.IssueResolution;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public final class IssueCommands {
    private static final Pattern NON_BLANK = Pattern.compile("\\S", Pattern.UNICODE_CHARACTER_CLASS);

    private IssueCommands() {}

    public record Take(long expectedIssueRevision) {
        public Take {
            revision(expectedIssueRevision);
        }
    }

    public record Retry(long expectedIssueRevision, String reason, UUID reconciliationId) {
        public Retry {
            revision(expectedIssueRevision);
            IssueCommands.reason(reason);
        }
    }

    public record Resolve(
            long expectedIssueRevision, UUID reconciliationId, IssueResolution.Action action, String reason) {
        public Resolve {
            revision(expectedIssueRevision);
            IssueCommands.reason(reason);
            Objects.requireNonNull(reconciliationId);
            Objects.requireNonNull(action);
        }
    }

    private static void revision(long value) {
        if (value < 1 || value > 9007199254740991L) throw RuleViolation.invalid("Некорректная версия проблемы");
    }

    private static void reason(String value) {
        if (value == null || value.length() > 500 || value.indexOf(0) >= 0 || !NON_BLANK.matcher(value).find())
            throw RuleViolation.invalid("Укажите непустую причину длиной до 500 символов без нулевого символа");
    }
}
