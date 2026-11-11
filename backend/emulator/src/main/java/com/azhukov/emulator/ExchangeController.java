package com.azhukov.emulator;

import com.azhukov.integration.contract.external.api.ExchangeApi;
import com.azhukov.integration.contract.external.model.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
class ExchangeController implements ExchangeApi {
    private final OperationService service;
    private final OperationRepository operations;

    ExchangeController(OperationService service, OperationRepository operations) {
        this.service = service; this.operations = operations;
    }

    @Override
    public ResponseEntity<Acknowledgement> acceptOperation(UUID id, OperationInput input) {
        var accepted = service.accept(id, input);
        if (accepted.dropResponse()) {
            // The commit is already visible to GET; only this first HTTP response is delayed.
            try { Thread.sleep(5000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        var operation = accepted.operation();
        return ResponseEntity.status(accepted.created() ? 202 : 200)
            .body(new Acknowledgement(id, operation.getRequest(), operation.getAcceptedAt()));
    }

    @Override
    public ResponseEntity<OperationState> inspectOperation(UUID id) { return ResponseEntity.ok(operations.get(id)); }

    @Override
    public ResponseEntity<List<ResultEvent>> listResultEvents(Long after, Integer limit) {
        return ResponseEntity.ok(operations.events(after, limit));
    }
}
