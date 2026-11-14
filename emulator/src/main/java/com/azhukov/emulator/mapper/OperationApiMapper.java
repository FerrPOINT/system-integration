package com.azhukov.emulator.mapper;

import com.azhukov.emulator.config.MapStructConfig;
import com.azhukov.emulator.domain.Operation;
import com.azhukov.emulator.domain.OperationRequest;
import com.azhukov.emulator.domain.OperationResult;
import com.azhukov.integration.contract.external.model.*;
import java.util.List;
import org.mapstruct.Mapper;

@Mapper(config = MapStructConfig.class)
public interface OperationApiMapper {
    OperationInput input(OperationRequest value);

    OperationRequest request(OperationInput value);

    Result result(OperationResult value);

    OperationState operation(Operation value);

    Acknowledgement acknowledgement(Operation value);

    ResultEvent event(com.azhukov.emulator.domain.ResultEvent value);

    List<ResultEvent> events(List<com.azhukov.emulator.domain.ResultEvent> values);

    default Result.VersionEnum version(int value) {
        return Result.VersionEnum.fromValue(value);
    }

    default OperationState.ExecutionsEnum executions(int value) {
        return OperationState.ExecutionsEnum.fromValue(value);
    }
}
