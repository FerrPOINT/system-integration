package com.azhukov.integration.tasks;

import com.azhukov.integration.contract.ExchangeReply;
import com.azhukov.integration.contract.external.model.OperationInput;
import com.azhukov.integration.contract.external.model.Result;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.contract.internal.model.HistoryEvent;
import com.azhukov.integration.contract.ExchangeProtocol;
import com.azhukov.integration.domain.RuleViolation;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;

@Service
public class ExchangeTasks {
    private final TaskRepository tasks;
    private final ExchangeIssues issues;
    private final ExchangeProtocol protocol;

    public ExchangeTasks(TaskRepository tasks, ExchangeIssues issues, ObjectMapper json) {
        this.tasks = tasks; this.issues = issues;
        this.protocol = new ExchangeProtocol(json);
    }

    public record Claim(UUID operationId, UUID attemptId, String step, int number, OperationInput request) {}

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
            tasks.history(state.task(), null, HistoryEvent.TypeEnum.DELIVERY_UNCERTAIN,
                "Прерванная попытка: следующее действие — уточняющий GET", Map.of("attemptId",queue.claim()));
            return null;
        }
        UUID claim = UUID.randomUUID();
        int number = Math.addExact(queue.attempts(),1);
        tasks.startAttempt(state.task().operationId(),claim,queue.step(),number);
        tasks.history(state.task(), null, HistoryEvent.TypeEnum.DELIVERY_ATTEMPT,
            "Попытка " + number + ": " + queue.step(), Map.of("attemptId",claim));
        return new Claim(state.task().operationId(), claim, queue.step(), number, input(state));
    }

    @Transactional
    public void finish(Claim claim, ExchangeReply reply) {
        var state = tasks.exchange(claim.operationId(), true);
        boolean owned = tasks.ownsClaim(claim.operationId(),claim.attemptId());
        if (!owned) {
            finishAttempt(claim, "LATE_RESPONSE_IGNORED");
            tasks.history(state.task(),null,HistoryEvent.TypeEnum.DELIVERY_ATTEMPT,
                "Поздний исход попытки не изменил состояние",Map.of("attemptId",claim.attemptId()));
            return;
        }
        boolean confirmed = false;
        String invalid = null;
        if ((claim.step().equals("PUT") && (reply.status() == 200 || reply.status() == 202)) ||
            (claim.step().equals("GET") && reply.status() == 200)) {
            try {
                var expected = new ExchangeProtocol.Identity(claim.operationId(), claim.request());
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
        if (!repeatPut) tasks.history(state.task(), null, HistoryEvent.TypeEnum.DELIVERY_UNCERTAIN,
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
        issues.open(null, null, "RESULT_CONFLICT", "Некорректная структура страницы или позиция ленты", page, null, null);
    }

    private void receive(JsonNode raw, long cursor) {
        Result received;
        try { received = protocol.result(raw); }
        catch (RuntimeException malformed) {
            UUID id = operationId(raw);
            var state = find(id);
            issues.open(state, id, "RESULT_CONFLICT", "Входящий снимок не соответствует контракту", raw, null, cursor);
            return;
        }
        var state = find(received.getOperationId());
        if (state == null) {
            issues.open(null, received.getOperationId(), "RESULT_CONFLICT", "Неизвестная внешняя операция", received, received, cursor);
            return;
        }
        try { ExchangeProtocol.same(new ExchangeProtocol.Identity(received.getOperationId(), received.getRequest()), identity(state)); }
        catch (IllegalArgumentException different) {
            issues.open(state, received.getOperationId(), "RESULT_CONFLICT", "Запрос события не совпадает с заданием", received, received, cursor);
            return;
        }
        if (state.result() != null) {
            int oldVersion = state.result().getVersion().getValue();
            int newVersion = received.getVersion().getValue();
            if (oldVersion == newVersion && state.result().equals(received)) return;
            if (oldVersion > newVersion) {
                tasks.history(state.task(), null, HistoryEvent.TypeEnum.RESULT_IGNORED, "Запоздалый снимок не изменил результат",
                    Map.of("resultVersion",newVersion));
                return;
            }
        }
        if (state.task().deliveryStatus() == DeliveryStatus.NEEDS_REVIEW) {
            issues.observe(state, received);
            return;
        }
        if (state.task().deliveryStatus() == DeliveryStatus.STOPPED) {
            issues.open(state, received.getOperationId(), "RECONCILIATION_DIFFERENCE",
                "Внешний снимок после остановки отправки требует решения оператора", received, received, cursor);
            return;
        }
        if (state.result() != null && state.result().getVersion() == received.getVersion()) {
            issues.open(state, received.getOperationId(), "RESULT_CONFLICT", "Разное содержимое одной версии результата", received, received, cursor);
            return;
        }
        apply(state, received, null);
    }

    public void apply(TaskRepository.ExchangeTask state, Result result, UUID actor) {
        tasks.applyResult(result);
        tasks.removeQueue(result.getOperationId());
        issues.confirm(state);
        tasks.history(state.task(), actor, HistoryEvent.TypeEnum.RESULT_APPLIED,
            "Принят внешний результат: " + result.getStatus().getValue(), Map.of("resultVersion",result.getVersion().getValue()));
    }

    public void acknowledge(TaskRepository.ExchangeTask state) {
        state = delivery(state, DeliveryStatus.ACKNOWLEDGED);
        tasks.removeQueue(state.task().operationId());
        issues.confirm(state);
        tasks.history(state.task(), null, HistoryEvent.TypeEnum.DELIVERY_ACKNOWLEDGED, "Исполнитель подтвердил получение операции");
    }

    private TaskRepository.ExchangeTask find(UUID id) {
        if (id == null) return null;
        try { return tasks.exchange(id,true); }
        catch (RuleViolation notFound) { if (notFound.code() == RuleViolation.Code.NOT_FOUND) return null; throw notFound; }
    }

    private void finishAttempt(Claim claim, String outcome) {
        tasks.finishAttempt(claim.attemptId(),outcome);
    }

    private TaskRepository.ExchangeTask delivery(TaskRepository.ExchangeTask state, DeliveryStatus status) {
        tasks.delivery(state.task().operationId(),status);
        return new TaskRepository.ExchangeTask(state.task().withDeliveryStatus(status),state.version(),state.result());
    }

    public static int delay(int attempts) { return switch(attempts) { case 1 -> 2; case 2 -> 5; case 3 -> 15; default -> 60; }; }
    public static OperationInput input(TaskRepository.ExchangeTask state) {
        return new OperationInput(state.task().request().reference(),state.task().request().quantity());
    }
    public static ExchangeProtocol.Identity identity(TaskRepository.ExchangeTask state) {
        return new ExchangeProtocol.Identity(state.task().operationId(),input(state));
    }

    private UUID operationId(JsonNode raw) {
        try { return UUID.fromString(raw.path("operationId").asString()); }
        catch (RuntimeException invalid) { return null; }
    }
}
