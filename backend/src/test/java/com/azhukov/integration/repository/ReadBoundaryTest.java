package com.azhukov.integration.repository;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.Repository;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

class ReadBoundaryTest {
    private static final ArchRule DATA_BOUNDARY=noClasses().that()
        .resideOutsideOfPackage("com.azhukov.integration.repository.springdata..")
        .should().dependOnClassesThat().resideInAnyPackage("org.springframework.data..","org.postgresql..");

    @Test
    void onlyReadAdaptersDependOnSpringDataOrTheDriver() {
        DATA_BOUNDARY.check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.azhukov.integration"));
    }

    @Test
    void persistenceRowsAndAdaptersDoNotEscapeTheirPackage() {
        noClasses().that().resideOutsideOfPackage("com.azhukov.integration.repository.springdata..")
            .should().dependOnClassesThat().resideInAPackage("com.azhukov.integration.repository.springdata..")
            .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.azhukov.integration"));
    }

    @Test
    void ruleRejectsDataAccessInAnotherLayer() {
        assertThrows(AssertionError.class,() -> DATA_BOUNDARY.check(new ClassFileImporter().importClasses(BadConsumer.class)));
    }

    @Test
    void generatedRepositoriesExposeOnlyBoundedReads() throws Exception {
        requireReadOnly(Class.forName("com.azhukov.integration.repository.springdata.TaskRows"));
        requireReadOnly(Class.forName("com.azhukov.integration.repository.springdata.HistoryRows"));
        assertThrows(AssertionError.class,() -> requireReadOnly(BadWrites.class));
    }

    private void requireReadOnly(Class<?> type) {
        assertTrue(Repository.class.isAssignableFrom(type));
        assertFalse(CrudRepository.class.isAssignableFrom(type));
        for (var method:type.getMethods())
            assertTrue(method.getName().startsWith("findBy") || method.getName().startsWith("countBy"));
    }

    private static class BadConsumer { Repository<?,?> data; }
    private interface BadWrites extends CrudRepository<com.azhukov.integration.domain.task.Task,java.util.UUID> {}
}
