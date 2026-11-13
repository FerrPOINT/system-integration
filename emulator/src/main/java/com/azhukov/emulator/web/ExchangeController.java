package com.azhukov.emulator.web;

import lombok.RequiredArgsConstructor;
import com.azhukov.emulator.application.OperationService;
import com.azhukov.emulator.domain.OperationRequest;

import com.azhukov.integration.contract.external.api.ExchangeApi;
import com.azhukov.integration.contract.external.model.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class ExchangeController implements ExchangeApi {
    private final OperationService service;

    @Override
    public ResponseEntity<Acknowledgement> acceptOperation(UUID id, OperationInput input) {
        var accepted = service.accept(id,new OperationRequest(input.getReference(),input.getQuantity()));
        if (accepted.dropResponse()) {
            // The commit is already visible to GET; only this first HTTP response is delayed.
            try { Thread.sleep(5000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        var operation = accepted.operation();
        return ResponseEntity.status(accepted.created() ? 202 : 200)
            .body(new Acknowledgement(id, Views.input(operation.request()),operation.acceptedAt()));
    }

    @Override
    public ResponseEntity<OperationState> inspectOperation(UUID id) { return ResponseEntity.ok(Views.operation(service.get(id))); }

    @Override
    public ResponseEntity<List<ResultEvent>> listResultEvents(Long after, Integer limit) {
        return ResponseEntity.ok(service.events(after,limit).stream().map(Views::event).toList());
    }
}
