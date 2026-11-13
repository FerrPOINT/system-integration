package com.azhukov.emulator.web;

import com.azhukov.integration.contract.external.model.*;
import com.azhukov.emulator.domain.Operation;
import com.azhukov.emulator.domain.OperationRequest;
import com.azhukov.emulator.domain.OperationResult;

final class Views {
    private Views() {}
    static OperationInput input(OperationRequest value) { return new OperationInput(value.reference(),value.quantity()); }
    static Result result(OperationResult value) {
        if (value==null) return null;
        return new Result(value.operationId(),input(value.request()),Result.VersionEnum.fromValue(value.version()),
            Result.StatusEnum.fromValue(value.status().name())).completedAt(value.completedAt()).rejectionCode(value.rejectionCode());
    }
    static OperationState operation(Operation value) {
        return new OperationState(value.operationId(),input(value.request()),value.acceptedAt(),
            OperationState.ExecutionsEnum.fromValue(value.executions()),result(value.result()));
    }
    static ResultEvent event(com.azhukov.emulator.domain.ResultEvent value) { return new ResultEvent(value.cursor(),result(value.result())); }
}
