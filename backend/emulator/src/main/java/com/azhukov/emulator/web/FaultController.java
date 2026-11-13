package com.azhukov.emulator.web;

import com.azhukov.emulator.application.OperationService;
import com.azhukov.emulator.domain.FaultMode;

import com.azhukov.integration.contract.external.api.TestFaultsApi;
import com.azhukov.integration.contract.external.model.FaultConfiguration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("test-faults")
class FaultController implements TestFaultsApi {
    private final OperationService operations;
    FaultController(OperationService operations) { this.operations = operations; }

    @Override
    public ResponseEntity<Void> configureFault(String reference, FaultConfiguration input) {
        operations.configure(reference, FaultMode.valueOf(input.getMode().getValue()));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> clearFault(String reference) {
        operations.clear(reference);
        return ResponseEntity.noContent().build();
    }
}
