package com.azhukov.integration.application;

import com.azhukov.integration.domain.RuleViolation;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class PageTest {
    @Test void totalsUseTheRequestedSizeIncludingEmptyAndLastPages() {
        assertEquals(4,new Page<>(List.of(),0,7,25).totalPages());
        assertTrue(new Page<>(List.of(),2,7,25).hasNext());
        assertFalse(new Page<>(List.of(),3,7,25).hasNext());
        assertEquals(0,new Page<>(List.of(),0,1,0).totalPages());
        assertEquals(1,new Page<>(List.of(),0,100,25).totalPages());
    }
    @Test void invalidWindowsAreRejectedInsteadOfSilentlyClamped() {
        for (int size:new int[]{0,-1,101,Integer.MAX_VALUE})
            assertThrows(RuleViolation.class,() -> Page.requireValid(0,size));
        assertThrows(RuleViolation.class,() -> Page.requireValid(-1,20));
        assertDoesNotThrow(() -> Page.requireValid(0,1));
        assertDoesNotThrow(() -> Page.requireValid(0,100));
    }
}
