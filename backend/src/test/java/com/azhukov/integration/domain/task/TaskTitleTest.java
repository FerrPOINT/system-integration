package com.azhukov.integration.domain.task;

import com.azhukov.integration.domain.RuleViolation;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TaskTitleTest {
    @Test
    void renameReturnsANewVersionWithoutChangingThePreviousTitle() {
        var original = new TaskTitle("Первое имя",7);
        assertEquals(new TaskTitle("Второе имя",8),original.rename("Второе имя",7));
        assertEquals(new TaskTitle("Первое имя",7),original);
        // An intentional rename to the same text is still a versioned command.
        assertEquals(8,original.rename("Первое имя",7).revision());
    }

    @Test
    void staleVersionCannotOverwriteTheCurrentTitle() {
        var current = new TaskTitle("Текущее",8);
        var error = assertThrows(RuleViolation.class,() -> current.rename("Устаревшее",7));
        assertEquals(RuleViolation.Code.TITLE_REVISION_CONFLICT,error.code());
        assertEquals("Текущее",current.value());
    }

    @Test
    void lastSafeRevisionIsAcceptedButCannotOverflow() {
        var before = new TaskTitle("Название",TaskTitle.MAX_REVISION-1);
        var last = before.rename("Последнее",TaskTitle.MAX_REVISION-1);
        assertEquals(TaskTitle.MAX_REVISION,last.revision());
        assertEquals(RuleViolation.Code.VALIDATION_FAILED,
            assertThrows(RuleViolation.class,() -> last.rename("Лишнее",TaskTitle.MAX_REVISION)).code());
    }

    @Test
    void titleMustRespectTheExistingInputLimits() {
        for (var invalid : new String[]{""," \n\t","x".repeat(161)}) {
            assertEquals(RuleViolation.Code.VALIDATION_FAILED,
                assertThrows(RuleViolation.class,() -> new TaskTitle(invalid,1)).code());
        }
        assertThrows(RuleViolation.class,() -> new TaskTitle(null,1));
        assertEquals("x".repeat(160),new TaskTitle("x".repeat(160),1).value());
        assertEquals("\nИмя\n",new TaskTitle("\nИмя\n",1).value());
    }

    @Test
    void persistedRevisionMustBeWithinTheContractRange() {
        assertThrows(RuleViolation.class,() -> new TaskTitle("Имя",0));
        assertThrows(RuleViolation.class,() -> new TaskTitle("Имя",TaskTitle.MAX_REVISION+1));
    }
}
