package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.TaskInput;
import org.junit.jupiter.api.Test;
import java.util.UUID;
import static com.azhukov.integration.domain.exchange.DeliveryAttempt.Outcome.*;
import static org.junit.jupiter.api.Assertions.*;

class DeliveryAttemptTest {
    private DeliveryAttempt attempt(String step,int number) {
        return new DeliveryAttempt(UUID.randomUUID(),UUID.randomUUID(),step,number,new TaskInput("REQ-000001",25));
    }

    @Test
    void ambiguousDeliveryAlwaysChecksBeforeAnotherPutWhileDefiniteFailureCanRepeatPut() {
        var uncertain=attempt("PUT",1).decide(TEMPORARY_FAILURE);
        assertEquals(DeliveryStatus.UNKNOWN,uncertain.status());
        assertEquals("GET",uncertain.nextStep()); assertTrue(uncertain.temporaryIssue()); assertTrue(uncertain.uncertainHistory());
        var refused=attempt("PUT",1).decide(CONNECT_FAILED);
        assertEquals(DeliveryStatus.RETRY_WAIT,refused.status());
        assertEquals("PUT",refused.nextStep()); assertFalse(refused.temporaryIssue()); assertFalse(refused.uncertainHistory());
        assertEquals("GET",attempt("GET",1).decide(CONNECT_FAILED).nextStep());
        assertEquals("GET",attempt("GET",1).decide(TEMPORARY_FAILURE).nextStep());
        assertEquals("PUT",attempt("GET",2).decide(NOT_FOUND).nextStep());
    }

    @Test
    void delayAndEscalationRetainTheSameCounterAcrossGetAndPut() {
        for (int n=1;n<=8;n++) {
            assertEquals(new int[]{2,5,15,60,60,60,60,60}[n-1],attempt("PUT",n).decide(CONNECT_FAILED).delaySeconds());
            assertEquals(n>=4,attempt("PUT",n).decide(CONNECT_FAILED).temporaryIssue());
            assertTrue(attempt("GET",n).decide(TEMPORARY_FAILURE).temporaryIssue());
        }
    }

    @Test
    void confirmationAndProtocolPauseNeverScheduleAnAutomaticRetry() {
        var confirmed=attempt("GET",3).decide(ACKNOWLEDGED);
        assertEquals(DeliveryStatus.ACKNOWLEDGED,confirmed.status()); assertNull(confirmed.nextStep());
        var paused=attempt("PUT",1).decide(PROTOCOL_ERROR);
        assertEquals(DeliveryStatus.NEEDS_REVIEW,paused.status()); assertNull(paused.nextStep());
        assertFalse(paused.uncertainHistory());
        assertThrows(IllegalArgumentException.class,() -> attempt("POST",1));
        assertThrows(IllegalArgumentException.class,() -> attempt("PUT",0));
    }
}
