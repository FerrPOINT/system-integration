package com.azhukov.integration.config;

import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.exchange.OperationResult;
import com.azhukov.integration.domain.exchange.OperationSnapshot;
import com.azhukov.integration.domain.review.*;
import com.azhukov.integration.domain.task.TaskOutcome;
import com.azhukov.integration.dto.review.IssueCommands;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Stored/external JSON rules stay in an adapter, outside the domain records. */
@Configuration(proxyBeanMethods=false)
public class DocumentJsonConfiguration {
    @Bean
    public JsonMapperBuilderCustomizer documents() {
        return builder -> builder.addMixIn(OperationResult.class,OptionalFields.class)
            .addMixIn(OperationSnapshot.class,RequiredNullable.class)
            .addMixIn(LocalSnapshot.class,OptionalFields.class)
            .addMixIn(TaskOutcome.class,OptionalFields.class)
            .addMixIn(Evidence.class,OptionalFields.class)
            .addMixIn(Issue.class,OptionalFields.class)
            .addMixIn(Reconciliation.class,OptionalFields.class)
            .addMixIn(IssueResolution.class,OptionalFields.class)
            .addMixIn(IssueCommands.Retry.class,OptionalFields.class);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    abstract static class OptionalFields {}

    @JsonInclude(JsonInclude.Include.ALWAYS)
    abstract static class RequiredNullable {}
}
