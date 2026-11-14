package com.azhukov.integration.controller;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ControllerArchitectureTest {
    private static final ArchRule NO_SQL =
            noClasses()
                    .that()
                    .resideInAPackage("com.azhukov.integration.controller..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("org.springframework.jdbc..", "com.azhukov.integration.repository..");

    @Test
    void controllersAndHttpErrorsDoNotAccessSql() {
        var production =
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.azhukov.integration.controller");
        assertFalse(production.isEmpty());
        NO_SQL.check(production);
    }

    @Test
    void ruleRejectsDirectSqlInAController() {
        var fixture = new ClassFileImporter().importClasses(BadWeb.class);
        var error = assertThrows(AssertionError.class, () -> NO_SQL.check(fixture));
        assertTrue(error.getMessage().contains("org.springframework.jdbc.core.JdbcTemplate"));
    }

    private static class BadWeb {
        private JdbcTemplate jdbc;
    }
}
