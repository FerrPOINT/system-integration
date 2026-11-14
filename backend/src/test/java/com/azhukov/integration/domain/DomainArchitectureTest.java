package com.azhukov.integration.domain;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static org.junit.jupiter.api.Assertions.*;

class DomainArchitectureTest {
    private static final ArchRule DOMAIN = classes().that()
        .resideInAPackage("com.azhukov.integration.domain..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("java..","com.azhukov.integration.domain..");

    @Test
    void domainHasNoFrameworkPersistenceOrTransportDependencies() {
        var production = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration.domain");
        assertFalse(production.isEmpty(),"The architecture rule must inspect real production classes");
        DOMAIN.check(production);
    }

    @Test
    void dependencyRuleRejectsAJdbcLeak() {
        var fixture = new ClassFileImporter().importClasses(BadDomain.class);
        var error = assertThrows(AssertionError.class,() -> DOMAIN.check(fixture));
        assertTrue(error.getMessage().contains("org.springframework.jdbc.core.JdbcTemplate"));
    }

    private static class BadDomain {
        private JdbcTemplate jdbc;
    }
}
