package com.azhukov.emulator.controller;

import com.azhukov.emulator.mapper.OperationApiMapper;
import com.azhukov.emulator.service.OperationService;
import com.azhukov.integration.contract.external.api.TestFaultsApi;
import com.azhukov.integration.contract.external.model.FaultConfiguration;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("test-faults")
@RequiredArgsConstructor
class FaultController implements TestFaultsApi {
    private final OperationService operations;
    private final OperationApiMapper mapper;

    @Override
    public ResponseEntity<Void> configureFault(String reference, FaultConfiguration input) {
        operations.configure(reference, mapper.faultMode(input.getMode()));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> clearFault(String reference) {
        operations.clear(reference);
        return ResponseEntity.noContent().build();
    }
}
