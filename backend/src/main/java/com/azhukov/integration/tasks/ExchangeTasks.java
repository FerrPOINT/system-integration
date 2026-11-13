package com.azhukov.integration.tasks;

import com.azhukov.integration.application.port.TaskStore;
import com.azhukov.integration.domain.exchange.ExchangeState;
import com.azhukov.integration.domain.task.HistoryType;
import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.exchange.OperationIdentity;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.application.IssueService;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.infrastructure.http.ExchangeProtocol;
import com.azhukov.integration.domain.RuleViolation;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

import java.util.Map;
import java.util.UUID;

@Service
public class ExchangeTasks {
    private final TaskStore tasks;
    private final IssueService issues;
    private final ExchangeProtocol protocol;

    public ExchangeTasks(TaskStore tasks, IssueService issues) {
        this.tasks = tasks; this.issues = issues;
        this.protocol = new ExchangeProtocol();
    }

    public record Claim(UUID operationId, UUID attemptId, String step, int number, TaskInput request) {}

    @Transactional
    public Claim claim() {
        // All writers lock the task before its queue/issue rows to keep a single lock order.
        var due = tasks.lockDueOperation();
        if (due == null) return null;
        var state = tasks.exchange(due, true);
        var queue = tasks.lockQueue(state.task().operationId());
        if (queue.claim() != null) {
            tasks.finishAttempt(queue.claim(),"INTERRUPTED");
            tasks.scheduleAfterInterruptedClaim(state.task().operationId(),queue.until(),delay(queue.attempts()));
            state = delivery(state, DeliveryStatus.UNKNOWN);
            issues.temporary(state, queue.attempts() >= 4);
            tasks.history(state.task(), null, HistoryType.DELIVERY_UNCERTAIN,
                "Прерванная попытка: следующее действие — уточняющий GET", Map.of("attemptId",queue.claim()));
            return null;
        }
        UUID claim = UUID.randomUUID();
        int number = Math.addExact(queue.attempts(),1);
        tasks.startAttempt(state.task().operationId(),claim,queue.step(),number);
        tasks.history(state.task(), null, HistoryType.DELIVERY_ATTEMPT,
            "Попытка " + number + ": " + queue.step(), Map.of("attemptId",claim));
        return new Claim(state.task().operationId(), claim, queue.step(), number, input(state));
    }

    @Transactional
    public void finish(Claim claim, ExchangeReply reply) {
        var state = tasks.exchange(claim.operationId(), true);
        boolean owned = tasks.ownsClaim(claim.operationId(),claim.attemptId());
        if (!owned) {
            finishAttempt(claim, "LATE_RESPONSE_IGNORED");
            tasks.history(state.task(),null,HistoryType.DELIVERY_ATTEMPT,
                "Поздний исход попытки не изменил состояние",Map.of("attemptId",claim.attemptId()));
            return;
        }
        boolean confirmed = false;
        String invalid = null;
        if ((claim.step().equals("PUT") && (reply.status() == 200 || reply.status() == 202)) ||
            (claim.step().equals("GET") && reply.status() == 200)) {
            try {
                var expected = new OperationIdentity(claim.operationId(), claim.request());
                if (claim.step().equals("PUT")) protocol.acknowledgement(reply.body(), expected);
                else protocol.state(reply.body(), expected);
                confirmed = true;
            } catch (RuntimeException malformed) { invalid = "Подтверждение не соответствует контракту или исходному запросу"; }
        }
        if (confirmed) {
            acknowledge(state);
            finishAttempt(claim, "ACKNOWLEDGED");
            return;
        }
        boolean missing = claim.step().equals("GET") && ExchangeProtocol.missingOperation(reply.status(),reply.body());
        boolean temporary = reply.status() == 0 || reply.status() >= 500;
        if (invalid == null && !temporary && !missing) invalid = "Постоянная ошибка внешнего протокола, HTTP " + reply.status();
        if (invalid != null) {
            issues.protocol(state, invalid, reply.body());
            state = delivery(state, DeliveryStatus.NEEDS_REVIEW);
            tasks.pauseQueue(claim.operationId());
            finishAttempt(claim, "PROTOCOL_ERROR");
            return;
        }
        boolean repeatPut = missing || (claim.step().equals("PUT") && reply.connectionFailed());
        state = delivery(state, repeatPut ? DeliveryStatus.RETRY_WAIT : DeliveryStatus.UNKNOWN);
        tasks.scheduleRetry(claim.operationId(),repeatPut ? "PUT" : "GET",delay(claim.number()));
        if (!repeatPut || claim.number() >= 4) issues.temporary(state, claim.number() >= 4);
        if (!repeatPut) tasks.history(state.task(), null, HistoryType.DELIVERY_UNCERTAIN,
            "Исход доставки неизвестен; запланирован уточняющий GET", Map.of("attemptId",claim.attemptId()));
        finishAttempt(claim, missing ? "NOT_FOUND" : reply.connectionFailed() ? "CONNECT_FAILED" : "TEMPORARY_FAILURE");
    }

    @Transactional(readOnly = true)
    public long cursor() { return tasks.cursor(false); }

    @Transactional
    public boolean consume(long expected, JsonNode page) {
        long current = tasks.cursor(true);
        if (current != expected) return false;
        for (var event : page) {
            long cursor = event.get("cursor").longValue();
            receive(event.get("result"), cursor);
            current = cursor;
        }
        tasks.advanceCursor(current);
        return true;
    }

    @Transactional
    public void badPage(JsonNode page) {
        issues.open(null, null, Issue.Kind.RESULT_CONFLICT, "Некорректная структура страницы или позиция ленты", page, null, null);
    }

    private void receive(JsonNode raw, long cursor) {
        OperationResult received;
        try { received = protocol.result(raw); }
        catch (RuntimeException malformed) {
            UUID id = operationId(raw);
            var state = find(id);
            issues.open(state, id, Issue.Kind.RESULT_CONFLICT, "Входящий снимок не соответствует контракту", raw, null, cursor);
            return;
        }
        var state = find(received.operationId());
        if (state == null) {
            issues.open(null, received.operationId(), Issue.Kind.RESULT_CONFLICT, "Неизвестная внешняя операция", received, received, cursor);
            return;
        }
        switch (state.disposition(received)) {
            case REQUEST_MISMATCH -> issues.open(state, received.operationId(), Issue.Kind.RESULT_CONFLICT,
                "Запрос события не совпадает с заданием", received, received, cursor);
            case DUPLICATE -> { }
            case OLDER -> tasks.history(state.task(), null, HistoryType.RESULT_IGNORED,
                "Запоздалый снимок не изменил результат", Map.of("resultVersion",received.version()));
            case OBSERVE -> issues.observe(state, received);
            case STOPPED -> issues.open(state, received.operationId(), Issue.Kind.RECONCILIATION_DIFFERENCE,
                "Внешний снимок после остановки отправки требует решения оператора", received, received, cursor);
            case CONFLICT -> issues.open(state, received.operationId(), Issue.Kind.RESULT_CONFLICT,
                "Разное содержимое одной версии результата", received, received, cursor);
            case APPLY -> apply(state, received, null);
        }
    }

    public void apply(ExchangeState state, OperationResult result, UUID actor) {
        tasks.applyResult(result);
        tasks.removeQueue(result.operationId());
        issues.confirm(state);
        tasks.history(state.task(), actor, HistoryType.RESULT_APPLIED,
            "Принят внешний результат: " + result.status().name(), Map.of("resultVersion",result.version()));
    }

    public void acknowledge(ExchangeState state) {
        state = delivery(state, DeliveryStatus.ACKNOWLEDGED);
        tasks.removeQueue(state.task().operationId());
        issues.confirm(state);
        tasks.history(state.task(), null, HistoryType.DELIVERY_ACKNOWLEDGED, "Исполнитель подтвердил получение операции");
    }

    private ExchangeState find(UUID id) {
        if (id == null) return null;
        try { return tasks.exchange(id,true); }
        catch (RuleViolation notFound) { if (notFound.code() == RuleViolation.Code.NOT_FOUND) return null; throw notFound; }
    }

    private void finishAttempt(Claim claim, String outcome) {
        tasks.finishAttempt(claim.attemptId(),outcome);
    }

    private ExchangeState delivery(ExchangeState state, DeliveryStatus status) {
        tasks.delivery(state.task().operationId(),status);
        return state.withDeliveryStatus(status);
    }

    public static int delay(int attempts) { return switch(attempts) { case 1 -> 2; case 2 -> 5; case 3 -> 15; default -> 60; }; }
    public static TaskInput input(ExchangeState state) {
        return state.task().request();
    }
    public static OperationIdentity identity(ExchangeState state) {
        return state.identity();
    }

    private UUID operationId(JsonNode raw) {
        try { return UUID.fromString(raw.path("operationId").asString()); }
        catch (RuntimeException invalid) { return null; }
    }
}
