package com.azhukov.integration.repository;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class RepositoryArchitectureTest {
    private static final ArchRule SQL_BOUNDARY=noClasses().that()
        .resideOutsideOfPackage("com.azhukov.integration.repository.jdbc..")
        .should().dependOnClassesThat().resideInAPackage("org.springframework.jdbc..");

    @Test
    void onlyJdbcAdaptersDependOnSpringJdbc() {
        var production = new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration");
        assertFalse(production.isEmpty());
        SQL_BOUNDARY.check(production);
    }
    @Test
    void repositoryContractsDoNotDependOnImplementationsOrServices() {
        noClasses().that().resideInAPackage("com.azhukov.integration.repository")
            .should().dependOnClassesThat().resideInAnyPackage(
                "com.azhukov.integration.repository.jdbc..","com.azhukov.integration.service..",
                "com.azhukov.integration.controller..","com.azhukov.integration.contract..",
                "org.springframework..","tools.jackson..","com.fasterxml.jackson..")
            .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.azhukov.integration.repository"));
    }

    @Test
    void ruleRejectsSqlInAnotherAdapter() {
        var fixture=new ClassFileImporter().importClasses(BadAdapter.class);
        assertThrows(AssertionError.class,() -> SQL_BOUNDARY.check(fixture));
    }
    private static class BadAdapter { private JdbcTemplate jdbc; }
}
