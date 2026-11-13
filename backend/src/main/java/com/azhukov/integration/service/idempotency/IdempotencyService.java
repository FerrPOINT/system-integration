package com.azhukov.integration.service.idempotency;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.dto.CommandType;
import com.azhukov.integration.repository.CommandReceiptRepository;
import com.azhukov.integration.repository.CommandReceiptRepository.Receipt;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IdempotencyService {
    private final CommandReceiptRepository receipts;
    private final ObjectMapper json;

    public <T> T execute(UUID actor, CommandType command, UUID key, Object input,
                         Class<T> type, Supplier<T> operation) {
        receipts.lock(actor,command,key);
        String fingerprint = ContentFingerprint.of(json,input);
        var stored = receipts.find(actor,command,key);
        if (stored.isPresent()) return decode(stored.get(),fingerprint,type);
        T result = operation.get();
        receipts.insert(actor,command,key,fingerprint,responseStatus(command),json.writeValueAsString(result));
        return result;
    }

    public <T> Optional<T> replay(UUID actor, CommandType command, UUID key, Object input, Class<T> type) {
        return receipts.find(actor,command,key).map(receipt -> decode(receipt,ContentFingerprint.of(json,input),type));
    }

    private <T> T decode(Receipt receipt, String fingerprint, Class<T> type) {
        if (!receipt.fingerprint().equals(fingerprint))
            throw new RuleViolation(RuleViolation.Code.IDEMPOTENCY_CONFLICT,"Ключ уже использован для другой команды");
        return json.readValue(receipt.body(),type);
    }

    private static int responseStatus(CommandType command) {
        return switch (command) {
            case CREATE_TASK -> 201;
            case RENAME_TASK, RECONCILE, TAKE_ISSUE, RETRY_EXCHANGE, RESOLVE_ISSUE -> 200;
        };
    }
}
