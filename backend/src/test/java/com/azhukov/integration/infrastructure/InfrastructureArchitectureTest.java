package com.azhukov.integration.infrastructure;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class InfrastructureArchitectureTest {
    private static final ArchRule SQL_BOUNDARY=noClasses().that()
        .resideOutsideOfPackage("com.azhukov.integration.infrastructure.jdbc..")
        .should().dependOnClassesThat().resideInAPackage("org.springframework.jdbc..");

    @Test
    void onlyJdbcAdaptersDependOnSpringJdbc() {
        SQL_BOUNDARY.check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration"));
    }
    @Test
    void ruleRejectsSqlInAnotherAdapter() {
        var fixture=new ClassFileImporter().importClasses(BadAdapter.class);
        assertThrows(AssertionError.class,() -> SQL_BOUNDARY.check(fixture));
    }
    private static class BadAdapter { private JdbcTemplate jdbc; }
}
