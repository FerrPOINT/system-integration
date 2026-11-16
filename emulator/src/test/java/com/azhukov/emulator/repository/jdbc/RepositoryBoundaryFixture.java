package com.azhukov.emulator.repository.jdbc;

import com.azhukov.emulator.controller.ExchangeController;
import com.azhukov.emulator.service.OperationService;
import com.azhukov.integration.contract.external.model.OperationState;

public class RepositoryBoundaryFixture {
    public static class ServiceAccess {
        private OperationService operations;
    }

    public static class ControllerAccess {
        private ExchangeController controller;
    }

    public static class HttpDtoAccess {
        private OperationState response;
    }
}
