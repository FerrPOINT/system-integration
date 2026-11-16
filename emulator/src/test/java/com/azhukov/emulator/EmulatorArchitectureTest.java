package com.azhukov.emulator;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.emulator.controller.ControllerBoundaryFixture;
import com.azhukov.emulator.repository.jdbc.RepositoryBoundaryFixture;
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

    private static final ArchRule CONTROLLER =
            noClasses()
                    .that()
                    .resideInAPackage("com.azhukov.emulator.controller..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("com.azhukov.emulator.repository..", "org.springframework.jdbc..");
    private static final ArchRule REPOSITORY =
            noClasses()
                    .that()
                    .resideInAPackage("com.azhukov.emulator.repository.jdbc..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage(
                            "com.azhukov.emulator.service..",
                            "com.azhukov.emulator.controller..",
                            "com.azhukov.integration.contract..");

    @Test
    void controllersUseServicesInsteadOfRepositories() {
        assertFalse(production.isEmpty());
        CONTROLLER.check(production);
        for (var fixture :
                new Class<?>[] {
                    ControllerBoundaryFixture.RepositoryAccess.class, ControllerBoundaryFixture.SqlAccess.class
                }) {
            var imported = new ClassFileImporter().importClasses(fixture);
            var violation = assertThrows(AssertionError.class, () -> CONTROLLER.check(imported));
            assertTrue(violation.getMessage().contains(fixture.getName()), violation::getMessage);
        }
    }

    @Test
    void jdbcAdaptersDoNotDependOnServicesControllersOrHttpDtos() {
        assertFalse(production.isEmpty());
        REPOSITORY.check(production);
        for (var fixture :
                new Class<?>[] {
                    RepositoryBoundaryFixture.ServiceAccess.class,
                    RepositoryBoundaryFixture.ControllerAccess.class,
                    RepositoryBoundaryFixture.HttpDtoAccess.class
                }) {
            var imported = new ClassFileImporter().importClasses(fixture);
            var violation = assertThrows(AssertionError.class, () -> REPOSITORY.check(imported));
            assertTrue(violation.getMessage().contains(fixture.getName()), violation::getMessage);
        }
    }

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
