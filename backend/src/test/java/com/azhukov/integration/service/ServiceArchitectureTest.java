package com.azhukov.integration.service;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class ServiceArchitectureTest {
    private static final ArchRule BOUNDARY = noClasses().that()
        .resideInAPackage("com.azhukov.integration.service..")
        .should().dependOnClassesThat().resideInAnyPackage(
            "com.azhukov.integration.controller..","com.azhukov.integration.repository.jdbc..","com.azhukov.integration.client.http..",
            "com.azhukov.integration.tasks..","com.azhukov.integration.exchange..",
            "com.azhukov.integration.contract..","com.azhukov.integration.security..",
            "org.springframework.jdbc..","org.springframework.security..","org.springframework.web..",
            "jakarta.servlet..");

    @Test
    void useCasesDependOnDomainAndPortsInsteadOfAdaptersOrHttpDtos() {
        var production = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration.service");
        assertFalse(production.isEmpty());
        BOUNDARY.check(production);
    }

    @Test
    void businessServicesDoNotSerializeDocuments() {
        noClasses().that().resideInAPackage("com.azhukov.integration.service..")
            .and().resideOutsideOfPackage("com.azhukov.integration.service.idempotency..")
            .should().dependOnClassesThat().resideInAnyPackage("tools.jackson..","com.fasterxml.jackson..")
            .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.azhukov.integration.service"));
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
