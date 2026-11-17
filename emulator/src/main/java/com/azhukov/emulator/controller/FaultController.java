package com.azhukov.emulator.controller;

import com.azhukov.emulator.mapper.OperationApiMapper;
import com.azhukov.emulator.service.OperationService;
import com.azhukov.integration.contract.external.api.TestFaultsApi;
import com.azhukov.integration.contract.external.model.FaultConfiguration;
import java.util.UUID;
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
    public ResponseEntity<Void> configureFault(UUID operationId, FaultConfiguration input) {
        operations.configure(operationId, mapper.faultMode(input.getMode()));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> clearFault(UUID operationId) {
        operations.clear(operationId);
        return ResponseEntity.noContent().build();
    }
}
