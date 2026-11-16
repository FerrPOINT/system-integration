package com.azhukov.integration.domain.task;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.domain.RuleViolation;
import org.junit.jupiter.api.Test;

class TaskTitleTest {
    @Test
    void renameReturnsANewVersionWithoutChangingThePreviousTitle() {
        var original = new TaskTitle("Первое имя", 7);
        assertEquals(new TaskTitle("Второе имя", 8), original.rename("Второе имя", 7));
        assertEquals(new TaskTitle("Первое имя", 7), original);
        // An intentional rename to the same text is still a versioned command.
        assertEquals(8, original.rename("Первое имя", 7).revision());
    }

    @Test
    void staleVersionCannotOverwriteTheCurrentTitle() {
        var current = new TaskTitle("Текущее", 8);
        var error = assertThrows(RuleViolation.class, () -> current.rename("Устаревшее", 7));
        assertEquals(RuleViolation.Code.TITLE_REVISION_CONFLICT, error.code());
        assertEquals("Текущее", current.value());
    }

    @Test
    void lastSafeRevisionIsAcceptedButCannotOverflow() {
        var before = new TaskTitle("Название", TaskTitle.MAX_REVISION - 1);
        var last = before.rename("Последнее", TaskTitle.MAX_REVISION - 1);
        assertEquals(TaskTitle.MAX_REVISION, last.revision());
        assertEquals(
                RuleViolation.Code.VALIDATION_FAILED,
                assertThrows(RuleViolation.class, () -> last.rename("Лишнее", TaskTitle.MAX_REVISION)).code());
    }

    @Test
    void titleMustRespectTheExistingInputLimits() {
        for (var invalid :
                new String[] {
                    "",
                    " \n\t",
                    "\u2003",
                    "\u3000",
                    "\u00a0",
                    "x".repeat(161),
                    Character.toString(0),
                    "До" + Character.toString(0) + "после"
                }) {
            assertEquals(
                    RuleViolation.Code.VALIDATION_FAILED,
                    assertThrows(RuleViolation.class, () -> new TaskTitle(invalid, 1)).code());
        }
        assertThrows(RuleViolation.class, () -> new TaskTitle(null, 1));
        assertEquals("x".repeat(160), new TaskTitle("x".repeat(160), 1).value());
        assertEquals("Имя\u2003объекта", new TaskTitle("Имя\u2003объекта", 1).value());
        assertEquals("\nИмя\n", new TaskTitle("\nИмя\n", 1).value());
        assertEquals("Имя 😀", new TaskTitle("Имя 😀", 1).value());
    }

    @Test
    void persistedRevisionMustBeWithinTheContractRange() {
        assertThrows(RuleViolation.class, () -> new TaskTitle("Имя", 0));
        assertThrows(RuleViolation.class, () -> new TaskTitle("Имя", TaskTitle.MAX_REVISION + 1));
    }

    @Test
    void malformedUtf16IsRejectedWithoutRejectingSupplementaryCharacters() {
        for (String title : new String[] {"before\uD800after", "before\uDC00after", "\uD800\uD800", "\uDC00\uD800"}) {
            assertEquals(
                    RuleViolation.Code.VALIDATION_FAILED,
                    assertThrows(RuleViolation.class, () -> new TaskTitle(title, 1)).code());
            assertThrows(RuleViolation.class, () -> new TaskTitle("Existing", 1).rename(title, 1));
        }
        for (String title : new String[] {"Имя 😀", "𐀀".repeat(80), "Имя\u2003объекта"})
            assertEquals(title, new TaskTitle(title, 1).value());
    }
}
