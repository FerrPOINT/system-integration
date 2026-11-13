package com.azhukov.integration.mapper;

import com.azhukov.integration.config.MapStructConfig;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskOutcome;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.task.CreateTask;
import com.azhukov.integration.dto.task.HistoryEntry;
import com.azhukov.integration.dto.task.RenameTask;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;
import org.mapstruct.ValueMapping;

@Mapper(config = MapStructConfig.class)
public interface TaskApiMapper {
    @Mapping(target = "taskId", source = "id")
    @Mapping(target = "title", source = "title.value")
    @Mapping(target = "titleRevision", source = "title.revision")
    @Mapping(target = "result", source = "outcome")
    Task task(com.azhukov.integration.domain.task.Task value);

    Request request(TaskInput value);
    TaskInput input(Request value);
    CreateTask create(CreateTaskRequest value);
    CreateTaskResult created(CreateTask.Result value);
    RenameTask rename(RenameTaskRequest value);
    RenameTaskResult renamed(RenameTask.Result value);
    HistoryEvent history(HistoryEntry value);
    TaskResult result(TaskOutcome value);
    com.azhukov.integration.domain.task.BusinessStatus status(BusinessStatus value);

    @ValueMapping(source = "PENDING", target = MappingConstants.THROW_EXCEPTION)
    @ValueMapping(source = "RUNNING", target = MappingConstants.THROW_EXCEPTION)
    TaskResult.StatusEnum terminalStatus(com.azhukov.integration.domain.task.BusinessStatus value);

    default HistoryEvent.ResultVersionEnum historyVersion(Integer value) {
        return value == null ? null : HistoryEvent.ResultVersionEnum.fromValue(value);
    }

    @Mapping(target = "hasNext", expression = "java(value.hasNext())")
    @Mapping(target = "totalPages", expression = "java(value.totalPages())")
    TaskPage tasks(Page<com.azhukov.integration.domain.task.Task> value);

    @Mapping(target = "hasNext", expression = "java(value.hasNext())")
    @Mapping(target = "totalPages", expression = "java(value.totalPages())")
    HistoryPage history(Page<HistoryEntry> value);
}
