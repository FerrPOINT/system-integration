package com.azhukov.integration.mapper;

import com.azhukov.integration.config.MapStructConfig;
import com.azhukov.integration.contract.internal.model.*;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.dto.Page;
import com.azhukov.integration.dto.review.IssueCommands;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingConstants;
import org.mapstruct.ValueMapping;

@Mapper(config = MapStructConfig.class, uses = TaskApiMapper.class)
public interface ReviewApiMapper {
    @Mapping(target = "requestReference", ignore = true)
    @Mapping(target = "taskTitle", ignore = true)
    Issue issue(com.azhukov.integration.domain.review.Issue value);

    @Mapping(target = ".", source = "issue")
    Issue issueView(com.azhukov.integration.dto.review.IssueView value);

    IssueResolution resolution(com.azhukov.integration.domain.review.IssueResolution value);

    // Preserve the validated snapshot and its existing JSON contract.
    @Mapping(target = "external", expression = "java(value.external())")
    Reconciliation reconciliation(com.azhukov.integration.domain.review.Reconciliation value);

    ExchangeEvidence evidence(Evidence value);

    LocalSnapshot local(com.azhukov.integration.domain.exchange.LocalSnapshot value);

    ExchangeEvidenceReceived received(OperationResult value);

    ExchangeEvidenceReceivedRequest receivedRequest(com.azhukov.integration.domain.task.TaskInput value);

    com.azhukov.integration.domain.review.Issue.Status status(IssueStatus value);

    IssueCommands.Take take(TakeIssueRequest value);

    IssueCommands.Retry retry(RetryRequest value);

    IssueCommands.Resolve resolve(ResolveIssueRequest value);

    @ValueMapping(source = "PENDING", target = MappingConstants.THROW_EXCEPTION)
    ExchangeEvidenceReceived.StatusEnum receivedStatus(com.azhukov.integration.domain.task.BusinessStatus value);

    default LocalSnapshot.ResultVersionEnum localVersion(Integer value) {
        return value == null ? null : LocalSnapshot.ResultVersionEnum.fromValue(value);
    }

    default ExchangeEvidenceReceived.VersionEnum receivedVersion(int value) {
        return ExchangeEvidenceReceived.VersionEnum.fromValue(value);
    }

    @Mapping(target = "hasNext", expression = "java(value.hasNext())")
    @Mapping(target = "totalPages", expression = "java(value.totalPages())")
    IssuePage issues(Page<com.azhukov.integration.dto.review.IssueView> value);
}
