package com.azhukov.integration.dto.review;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.TextRule;
import com.azhukov.integration.domain.review.IssueResolution;
import java.util.UUID;

public final class IssueCommands {

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
            if (action == null) throw RuleViolation.invalid("Укажите действие");
            boolean feed = action == IssueResolution.Action.ACKNOWLEDGE_FEED_ISSUE;
            if (feed == (reconciliationId != null))
                throw RuleViolation.invalid(
                        feed ? "Общая проблема ленты не имеет сверки задания" : "Укажите сверку задания");
        }
    }

    private static void revision(long value) {
        if (value < 1 || value > 9007199254740991L) throw RuleViolation.invalid("Некорректная версия проблемы");
    }

    private static void reason(String value) {
        if (!TextRule.valid(value, 500))
            throw RuleViolation.invalid(
                    "Укажите непустую причину до 500 символов: корректный Unicode без нулевого символа");
    }
}
