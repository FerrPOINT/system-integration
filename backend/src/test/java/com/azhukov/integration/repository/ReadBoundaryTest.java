package com.azhukov.integration.repository;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.data.repository.CrudRepository;
import org.springframework.data.repository.Repository;

class ReadBoundaryTest {
    private static final ArchRule DATA_BOUNDARY =
            noClasses()
                    .that()
                    .resideOutsideOfPackage("com.azhukov.integration.repository.springdata..")
                    .should()
                    .dependOnClassesThat()
                    .resideInAnyPackage("org.springframework.data..", "org.postgresql..");

    @Test
    void onlyReadAdaptersDependOnSpringDataOrTheDriver() {
        DATA_BOUNDARY.check(
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.azhukov.integration"));
    }

    @Test
    void persistenceRowsAndAdaptersDoNotEscapeTheirPackage() {
        noClasses()
                .that()
                .resideOutsideOfPackage("com.azhukov.integration.repository.springdata..")
                .should()
                .dependOnClassesThat()
                .resideInAPackage("com.azhukov.integration.repository.springdata..")
                .check(
                        new ClassFileImporter()
                                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                                .importPackages("com.azhukov.integration"));
    }

    @Test
    void ruleRejectsDataAccessInAnotherLayer() {
        assertThrows(
                AssertionError.class,
                () -> DATA_BOUNDARY.check(new ClassFileImporter().importClasses(BadConsumer.class)));
    }

    private static final ArchRule NO_MUTATION =
            noClasses()
                    .should()
                    .callMethodWhere(
                            com.tngtech.archunit.base.DescribedPredicate.describe(
                                    "mutating aggregate operations",
                                    call ->
                                            call.getTargetOwner()
                                                            .isAssignableTo(
                                                                    org.springframework.data.jdbc.core
                                                                            .JdbcAggregateOperations.class)
                                                    && call.getTarget()
                                                            .getName()
                                                            .matches("(save|insert|update|delete|upsert).*")));

    @Test
    void readAdaptersCannotCallAggregateWrites() {
        NO_MUTATION.check(
                new ClassFileImporter()
                        .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.azhukov.integration.repository.springdata"));
        var error =
                assertThrows(
                        AssertionError.class,
                        () -> NO_MUTATION.check(new ClassFileImporter().importClasses(BadAggregateWrite.class)));
        assertTrue(error.getMessage().contains("deleteAll"));
    }

    private static class BadAggregateWrite {
        private org.springframework.data.jdbc.core.JdbcAggregateOperations aggregates;

        void write() {
            aggregates.deleteAll(com.azhukov.integration.domain.task.Task.class);
        }
    }

    @Test
    void generatedRepositoriesExposeOnlyBoundedReads() throws Exception {
        requireReadOnly(Class.forName("com.azhukov.integration.repository.springdata.TaskRows"));
        requireReadOnly(Class.forName("com.azhukov.integration.repository.springdata.HistoryRows"));
        assertThrows(AssertionError.class, () -> requireReadOnly(BadWrites.class));
    }

    private void requireReadOnly(Class<?> type) {
        assertTrue(Repository.class.isAssignableFrom(type));
        assertFalse(CrudRepository.class.isAssignableFrom(type));
        for (var method : type.getMethods()) {
            assertTrue(method.getName().startsWith("findBy") || method.getName().startsWith("countBy"));
            assertFalse(method.isAnnotationPresent(org.springframework.data.jdbc.repository.query.Modifying.class));
        }
    }

    private static class BadConsumer {
        Repository<?, ?> data;
    }

    private interface BadWrites extends CrudRepository<com.azhukov.integration.domain.task.Task, java.util.UUID> {}
}
