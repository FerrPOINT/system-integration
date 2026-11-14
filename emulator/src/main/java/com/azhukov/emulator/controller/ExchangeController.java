package com.azhukov.emulator.controller;

import com.azhukov.emulator.mapper.OperationApiMapper;
import com.azhukov.emulator.service.OperationService;
import com.azhukov.integration.contract.external.api.ExchangeApi;
import com.azhukov.integration.contract.external.model.*;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ExchangeController implements ExchangeApi {
    private final OperationService service;
    private final OperationApiMapper mapper;

    @Override
    public ResponseEntity<Acknowledgement> acceptOperation(UUID id, OperationInput input) {
        var accepted = service.accept(id,mapper.request(input));
        if (accepted.dropResponse()) {
            // The commit is already visible to GET; only this first HTTP response is delayed.
            try { Thread.sleep(5000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
        var operation = accepted.operation();
        return ResponseEntity.status(accepted.created() ? 202 : 200)
            .body(mapper.acknowledgement(operation));
    }

    @Override
    public ResponseEntity<OperationState> inspectOperation(UUID id) { return ResponseEntity.ok(mapper.operation(service.get(id))); }

    @Override
    public ResponseEntity<List<ResultEvent>> listResultEvents(Long after, Integer limit) {
        return ResponseEntity.ok(mapper.events(service.events(after,limit)));
    }
}
