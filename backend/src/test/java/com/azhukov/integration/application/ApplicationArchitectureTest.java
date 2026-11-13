package com.azhukov.integration.application;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class ApplicationArchitectureTest {
    private static final ArchRule BOUNDARY = noClasses().that()
        .resideInAPackage("com.azhukov.integration.application..")
        .should().dependOnClassesThat().resideInAnyPackage(
            "com.azhukov.integration.web..","com.azhukov.integration.infrastructure..",
            "com.azhukov.integration.tasks..","com.azhukov.integration.exchange..",
            "com.azhukov.integration.contract..","com.azhukov.integration.auth..",
            "org.springframework.jdbc..","org.springframework.security..","org.springframework.web..",
            "tools.jackson..","com.fasterxml.jackson..","jakarta.servlet..");

    @Test
    void useCasesDependOnDomainAndPortsInsteadOfAdaptersOrHttpDtos() {
        var production = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration.application");
        assertFalse(production.isEmpty());
        BOUNDARY.check(production);
    }

    @Test
    void ruleRejectsSqlInAUseCase() {
        var fixture = new ClassFileImporter().importClasses(BadApplication.class);
        var error = assertThrows(AssertionError.class,() -> BOUNDARY.check(fixture));
        assertTrue(error.getMessage().contains("org.springframework.jdbc.core.JdbcTemplate"));
    }

    private static class BadApplication {
        private JdbcTemplate jdbc;
    }
}
