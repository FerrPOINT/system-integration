package com.azhukov.emulator.config;

import com.azhukov.emulator.domain.OperationResult;
import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class DocumentJsonConfiguration {
    @Bean
    public JsonMapperBuilderCustomizer documents() {
        return builder -> builder.addMixIn(OperationResult.class, OptionalFields.class);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    abstract static class OptionalFields {}
}
