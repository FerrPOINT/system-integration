package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient.ProtocolEvidence;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.repository.ReviewRepository;
import com.azhukov.integration.repository.TaskRepository;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Issue changes and their audit entries join the caller's exchange transaction. */
@Service
@Transactional(propagation = Propagation.MANDATORY)
@RequiredArgsConstructor
public class IssueLifecycleService {
    private static final String DELAYED =
            "Автоматическая доставка приостановлена: исчерпан лимит "
                    + DeliveryAttempt.MAX_AUTOMATIC_ATTEMPTS
                    + " попыток";
    private final ReviewRepository issues;
    private final TaskRepository tasks;

    public UUID open(
            ExchangeState state,
            UUID operationId,
            Issue.Kind kind,
            String reason,
            Object content,
            OperationResult received,
            Long cursor) {
        var evidence = evidence(reason, content, cursor, state, received);
        // Human-readable diagnostics must not change the identity of a previously seen bad packet.
        Object original = content instanceof ProtocolEvidence classified ? classified.content() : content;
        var opened =
                issues.open(state == null ? null : state.task().id(), operationId, kind, reason, original, evidence);
        if (opened.created() && state != null)
            tasks.history(state.task(), null, HistoryType.ISSUE_OPENED, reason, Map.of("issueId", opened.id()));
        return opened.id();
    }

    public void temporary(ExchangeState state, boolean delayed) {
        UUID existing = issues.temporary(state.task().id());
        if (existing != null) {
            if (delayed) issues.delay(existing, DELAYED);
            return;
        }
        String reason = delayed ? DELAYED : "Получение операции исполнителем пока не подтверждено";
        open(
                state,
                state.task().operationId(),
                delayed ? Issue.Kind.DELIVERY_DELAYED : Issue.Kind.DELIVERY_UNCERTAIN,
                reason,
                reason,
                null,
                null);
    }

    public void exhausted(ExchangeState state, UUID lastAttempt) {
        temporary(state, true);
        var details = new java.util.LinkedHashMap<String, Object>();
        if (lastAttempt != null) details.put("attemptId", lastAttempt);
        tasks.history(state.task(), null, HistoryType.DELIVERY_ATTEMPT, DELAYED, details);
    }

    public void confirm(ExchangeState state) {
        for (UUID id : issues.confirm(state.task().id()))
            tasks.history(
                    state.task(),
                    null,
                    HistoryType.ISSUE_RESOLVED,
                    "Получение подтверждено; проблема доставки закрыта",
                    Map.of("issueId", id));
    }

    public UUID protocol(ExchangeState state, String reason, Object content) {
        UUID existing = issues.temporary(state.task().id());
        if (existing == null)
            return open(state, state.task().operationId(), Issue.Kind.PROTOCOL_ERROR, reason, content, null, null);
        issues.protocol(existing, reason, evidence(reason, content, null, state, null));
        tasks.history(state.task(), null, HistoryType.ISSUE_OPENED, reason, Map.of("issueId", existing));
        return existing;
    }

    private static Evidence evidence(
            String reason, Object content, Long cursor, ExchangeState state, OperationResult received) {
        String detail =
                content instanceof ProtocolEvidence classified ? reason + " [" + classified.detail() + "]" : reason;
        return new Evidence(detail, cursor, state == null ? null : LocalSnapshot.of(state), received);
    }

    public void observe(ExchangeState state, OperationResult result) {
        UUID issue = issues.observationIssue(state.task().id());
        tasks.observe(state.task(), issue, result, "Внешний снимок сохранён как наблюдение до решения оператора");
    }
}
