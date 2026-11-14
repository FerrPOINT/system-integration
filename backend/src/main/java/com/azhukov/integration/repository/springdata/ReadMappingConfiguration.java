package com.azhukov.integration.repository.springdata;

import java.util.List;
import org.postgresql.util.PGobject;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.data.convert.ReadingConverter;
import org.springframework.data.jdbc.core.convert.JdbcCustomConversions;
import org.springframework.data.jdbc.core.dialect.JdbcDialect;

/** Adds json/jsonb text reading while preserving Boot's dialect and standard converters. */
@Configuration(proxyBeanMethods=false)
class ReadMappingConfiguration {
    @Bean
    JdbcCustomConversions jdbcCustomConversions(JdbcDialect dialect) {
        return JdbcCustomConversions.of(dialect,List.of(JsonText.INSTANCE));
    }

    @ReadingConverter
    enum JsonText implements Converter<PGobject,String> {
        INSTANCE;
        @Override public String convert(PGobject value) {
            if (!"jsonb".equals(value.getType()) && !"json".equals(value.getType()))
                throw new IllegalArgumentException("Expected PostgreSQL json/jsonb, got "+value.getType());
            return value.getValue();
        }
    }
}
