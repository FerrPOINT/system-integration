package com.azhukov.integration.repository;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class RepositoryArchitectureTest {
    private static final ArchRule SQL_BOUNDARY =
            noClasses()
                    .that()
                    .resideOutsideOfPackage("com.azhukov.integration.repository.jdbc..")
                    .should()
                    .dependOnClassesThat(
                            com.tngtech.archunit.base.DescribedPredicate.describe(
                                    "Spring JDBC execution infrastructure",
                                    type ->
                                            type.getPackageName().startsWith("org.springframework.jdbc.")
                                                    // Spring Data @Query refers to these mapping interfaces in
                                                    // annotation defaults.
                                                    // They do not execute SQL; JdbcTemplate and other executors remain
                                                    // forbidden.
                                                    && !type.getName().equals("org.springframework.jdbc.core.RowMapper")
                                                    && !type.getName()
                                                            .equals(
                                                                    "org.springframework.jdbc.core.ResultSetExtractor")));

    @Test
    void onlyJdbcAdaptersDependOnSpringJdbcExecutors() {
        var production =
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.azhukov.integration");
        assertFalse(production.isEmpty());
        SQL_BOUNDARY.check(production);
    }

    @Test
    void repositoryContractsDoNotDependOnImplementationsOrServices() {
        noClasses()
                .that()
                .resideInAPackage("com.azhukov.integration.repository")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(
                        "com.azhukov.integration.repository.jdbc..",
                        "com.azhukov.integration.service..",
                        "com.azhukov.integration.controller..",
                        "com.azhukov.integration.contract..",
                        "org.springframework..",
                        "tools.jackson..",
                        "com.fasterxml.jackson..")
                .check(
                        new ClassFileImporter()
                                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                                .importPackages("com.azhukov.integration.repository"));
    }

    @Test
    void jdbcAdaptersDoNotDependOnServicesOrHttpBoundaries() {
        noClasses()
                .that()
                .resideInAPackage("com.azhukov.integration.repository.jdbc..")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(
                        "com.azhukov.integration.service..", "com.azhukov.integration.controller..",
                        "com.azhukov.integration.client.http..", "com.azhukov.integration.contract..")
                .check(
                        new ClassFileImporter()
                                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                                .importPackages("com.azhukov.integration.repository.jdbc"));
    }

    @Test
    void productionPackagesHaveNoCycles() {
        var production =
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.azhukov.integration");
        assertFalse(production.isEmpty());
        com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices()
                .matching("com.azhukov.integration.(*)..")
                .should()
                .beFreeOfCycles()
                .check(production);
    }

    @Test
    void ruleRejectsSqlInAnotherAdapter() {
        var fixture = new ClassFileImporter().importClasses(BadAdapter.class);
        assertThrows(AssertionError.class, () -> SQL_BOUNDARY.check(fixture));
        var readLeak = new ClassFileImporter().importPackages("com.azhukov.integration.repository.springdata");
        var error = assertThrows(AssertionError.class, () -> SQL_BOUNDARY.check(readLeak));
        assertTrue(error.getMessage().contains("JdbcTemplate"));
    }

    private static class BadAdapter {
        private JdbcTemplate jdbc;
    }
}
