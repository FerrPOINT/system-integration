package com.azhukov.emulator;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class EmulatorArchitectureTest {
    private final JavaClasses production=new ClassFileImporter()
        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("com.azhukov.emulator");
    private static final ArchRule SQL=noClasses().that()
        .resideOutsideOfPackage("com.azhukov.emulator.infrastructure.jdbc..")
        .should().dependOnClassesThat().resideInAPackage("org.springframework.jdbc..");

    @Test
    void domainHasOnlyJavaAndOwnModelDependencies() {
        noClasses().that().resideInAPackage("com.azhukov.emulator.domain..").should().dependOnClassesThat()
            .resideOutsideOfPackages("java..","com.azhukov.emulator.domain..").check(production);
    }
    @Test
    void applicationHasNoHttpJsonSqlOrAdapterDependencies() {
        noClasses().that().resideInAPackage("com.azhukov.emulator.application..").should().dependOnClassesThat()
            .resideInAnyPackage("com.azhukov.emulator.infrastructure..","com.azhukov.emulator.web..",
                "com.azhukov.integration..","org.springframework.jdbc..","org.springframework.web..",
                "tools.jackson..","com.fasterxml.jackson..","jakarta.servlet..").check(production);
    }
    @Test
    void sqlIsConfinedToJdbcAdaptersAndRuleDetectsViolations() {
        SQL.check(production);
        assertThrows(AssertionError.class,() -> SQL.check(new ClassFileImporter().importClasses(BadAdapter.class)));
    }
    private static class BadAdapter { private JdbcTemplate jdbc; }
}
