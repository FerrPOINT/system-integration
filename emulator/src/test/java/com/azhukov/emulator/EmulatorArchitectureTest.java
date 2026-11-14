package com.azhukov.emulator;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class EmulatorArchitectureTest {
    private final JavaClasses production =
            new ClassFileImporter()
                    .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                    .importPackages("com.azhukov.emulator");
    private static final ArchRule SQL =
            noClasses()
                    .that()
                    .resideOutsideOfPackage("com.azhukov.emulator.repository.jdbc..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAPackage("org.springframework.jdbc..");

    @Test
    void domainHasOnlyJavaAndOwnModelDependencies() {
        noClasses()
                .that()
                .resideInAPackage("com.azhukov.emulator.domain..")
                .should()
                .dependOnClassesThat()
                .resideOutsideOfPackages("java..", "com.azhukov.emulator.domain..")
                .check(production);
    }

    @Test
    void applicationHasNoHttpJsonSqlOrAdapterDependencies() {
        noClasses()
                .that()
                .resideInAPackage("com.azhukov.emulator.service..")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(
                        "com.azhukov.emulator.repository.jdbc..",
                        "com.azhukov.emulator.controller..",
                        "com.azhukov.integration..",
                        "org.springframework.jdbc..",
                        "org.springframework.web..",
                        "tools.jackson..",
                        "com.fasterxml.jackson..",
                        "jakarta.servlet..")
                .check(production);
    }

    @Test
    void sqlIsConfinedToJdbcAdaptersAndRuleDetectsViolations() {
        assertFalse(production.isEmpty());
        SQL.check(production);
        assertThrows(AssertionError.class, () -> SQL.check(new ClassFileImporter().importClasses(BadAdapter.class)));
    }

    @Test
    void productionPackagesHaveNoCycles() {
        assertFalse(production.isEmpty());
        com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices()
                .matching("com.azhukov.emulator.(*)..")
                .should()
                .beFreeOfCycles()
                .check(production);
    }

    private static class BadAdapter {
        private JdbcTemplate jdbc;
    }
}
