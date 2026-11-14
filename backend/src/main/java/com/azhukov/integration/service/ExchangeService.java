package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient.DeliveryReply;
import com.azhukov.integration.client.ExternalExchangeClient.IncomingEvent;
import com.azhukov.integration.domain.exchange.DeliveryAttempt;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.dto.exchange.DeliveryBacklog;
import com.azhukov.integration.repository.ExchangeRepository;
import com.azhukov.integration.repository.TaskRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ExchangeService {
    private final TaskRepository tasks;
    private final ExchangeRepository exchanges;
    private final IssueLifecycleService issues;

    @Transactional
    public DeliveryAttempt claim() {
        // All writers lock the task before its queue/issue rows to keep a single lock order.
        var state = exchanges.lockDueExchange();
        if (state == null) return null;
        var queue = exchanges.lockQueue(state.task().operationId());
        if (queue.claim() != null) {
            exchanges.finishAttempt(queue.claim(), "INTERRUPTED");
            if (DeliveryAttempt.exhausted(queue.automaticAttempts())) {
                pauseAutomaticSeries(state, queue.claim());
                return null;
            }
            exchanges.scheduleAfterInterruptedClaim(
                    state.task().operationId(), queue.until(), DeliveryAttempt.delay(queue.automaticAttempts()));
            state = delivery(state, DeliveryStatus.UNKNOWN);
            issues.temporary(state, false);
            tasks.history(
                    state.task(),
                    null,
                    HistoryType.DELIVERY_UNCERTAIN,
                    "Прерванная попытка: следующее действие — уточняющий GET",
                    Map.of("attemptId", queue.claim()));
            return null;
        }
        if (DeliveryAttempt.exhausted(queue.automaticAttempts())) {
            pauseAutomaticSeries(state, null);
            return null;
        }
        UUID claim = UUID.randomUUID();
        int number = Math.addExact(queue.attempts(), 1);
        exchanges.startAttempt(state.task().operationId(), claim, queue.step(), number);
        tasks.history(
                state.task(),
                null,
                HistoryType.DELIVERY_ATTEMPT,
                "Попытка " + number + ": " + queue.step(),
                Map.of("attemptId", claim));
        return new DeliveryAttempt(
                state.task().operationId(),
                claim,
                queue.step(),
                number,
                queue.automaticAttempts() + 1,
                state.task().request());
    }

    @Transactional
    public void finish(DeliveryAttempt claim, DeliveryReply reply) {
        var state = exchanges.exchange(claim.operationId(), true);
        boolean owned = exchanges.ownsClaim(claim.operationId(), claim.attemptId());
        if (!owned) {
            finishAttempt(claim, "LATE_RESPONSE_IGNORED");
            tasks.history(
                    state.task(),
                    null,
                    HistoryType.DELIVERY_ATTEMPT,
                    "Поздний исход попытки не изменил состояние",
                    Map.of("attemptId", claim.attemptId()));
            return;
        }
        var decision = claim.decide(reply.outcome());
        if (decision.status() == DeliveryStatus.ACKNOWLEDGED) {
            acknowledge(state);
            finishAttempt(claim, "ACKNOWLEDGED");
            return;
        }
        if (decision.limitReached()) {
            pauseAutomaticSeries(state, claim.attemptId());
            finishAttempt(claim, reply.outcome().name());
            return;
        }
        if (decision.status() == DeliveryStatus.NEEDS_REVIEW) {
            issues.protocol(state, reply.protocolFailure(), reply.evidence());
            state = delivery(state, DeliveryStatus.NEEDS_REVIEW);
            exchanges.pauseQueue(claim.operationId());
            finishAttempt(claim, "PROTOCOL_ERROR");
            return;
        }
        state = delivery(state, decision.status());
        exchanges.scheduleRetry(claim.operationId(), decision.nextStep(), decision.delaySeconds());
        if (decision.temporaryIssue()) issues.temporary(state, false);
        if (decision.uncertainHistory())
            tasks.history(
                    state.task(),
                    null,
                    HistoryType.DELIVERY_UNCERTAIN,
                    "Исход доставки неизвестен; запланирован уточняющий GET",
                    Map.of("attemptId", claim.attemptId()));
        finishAttempt(claim, reply.outcome().name());
    }

    @Transactional(readOnly = true)
    public DeliveryBacklog backlog() {
        return exchanges.backlog();
    }

    @Transactional(readOnly = true)
    public long cursor() {
        return exchanges.cursor(false);
    }

    @Transactional
    public boolean consume(long expected, List<IncomingEvent> page) {
        long current = exchanges.cursor(true);
        if (current != expected) return false;
        var ids =
                page.stream()
                        .map(event -> event.result() == null ? event.operationId() : event.result().operationId())
                        .filter(java.util.Objects::nonNull)
                        .distinct()
                        .toList();
        var states = new java.util.HashMap<>(exchanges.lockExchanges(ids));
        for (var event : page) {
            receive(event, states);
            current = event.cursor();
        }
        exchanges.advanceCursor(current);
        return true;
    }

    @Transactional
    public void badPage(Object page) {
        issues.open(
                null,
                null,
                Issue.Kind.RESULT_CONFLICT,
                "Некорректная структура страницы или позиция ленты",
                page,
                null,
                null);
    }

    private void receive(IncomingEvent event, Map<UUID, ExchangeState> states) {
        var received = event.result();
        long cursor = event.cursor();
        if (received == null) {
            var state = states.get(event.operationId());
            issues.open(
                    state,
                    event.operationId(),
                    Issue.Kind.RESULT_CONFLICT,
                    "Входящий снимок не соответствует контракту",
                    event.evidence(),
                    null,
                    cursor);
            return;
        }
        var state = states.get(received.operationId());
        if (state == null) {
            issues.open(
                    null,
                    received.operationId(),
                    Issue.Kind.RESULT_CONFLICT,
                    "Неизвестная внешняя операция",
                    received,
                    received,
                    cursor);
            return;
        }
        switch (state.disposition(received)) {
            case REQUEST_MISMATCH ->
                    issues.open(
                            state,
                            received.operationId(),
                            Issue.Kind.RESULT_CONFLICT,
                            "Запрос события не совпадает с заданием",
                            received,
                            received,
                            cursor);
            case DUPLICATE -> {}
            case OLDER ->
                    tasks.history(
                            state.task(),
                            null,
                            HistoryType.RESULT_IGNORED,
                            "Запоздалый снимок не изменил результат",
                            Map.of("resultVersion", received.version()));
            case OBSERVE -> issues.observe(state, received);
            case STOPPED ->
                    issues.open(
                            state,
                            received.operationId(),
                            Issue.Kind.RECONCILIATION_DIFFERENCE,
                            "Внешний снимок после остановки отправки требует решения оператора",
                            received,
                            received,
                            cursor);
            case CONFLICT ->
                    issues.open(
                            state,
                            received.operationId(),
                            Issue.Kind.RESULT_CONFLICT,
                            "Разное содержимое одной версии результата",
                            received,
                            received,
                            cursor);
            case APPLY -> states.put(received.operationId(), apply(state, received, null));
        }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public ExchangeState apply(ExchangeState state, OperationResult result, UUID actor) {
        exchanges.applyResult(result);
        exchanges.removeQueue(result.operationId());
        issues.confirm(state);
        tasks.history(
                state.task(),
                actor,
                HistoryType.RESULT_APPLIED,
                "Принят внешний результат: " + result.status().name(),
                Map.of("resultVersion", result.version()));
        return state.withAppliedResult(result);
    }

    private void pauseAutomaticSeries(ExchangeState state, UUID lastAttempt) {
        state = delivery(state, DeliveryStatus.NEEDS_REVIEW);
        exchanges.pauseQueue(state.task().operationId());
        issues.exhausted(state, lastAttempt);
    }

    private void acknowledge(ExchangeState state) {
        state = delivery(state, DeliveryStatus.ACKNOWLEDGED);
        exchanges.removeQueue(state.task().operationId());
        issues.confirm(state);
        tasks.history(
                state.task(), null, HistoryType.DELIVERY_ACKNOWLEDGED, "Исполнитель подтвердил получение операции");
    }

    private void finishAttempt(DeliveryAttempt claim, String outcome) {
        exchanges.finishAttempt(claim.attemptId(), outcome);
    }

    private ExchangeState delivery(ExchangeState state, DeliveryStatus status) {
        exchanges.delivery(state.task().operationId(), status);
        return state.withDeliveryStatus(status);
    }
}
