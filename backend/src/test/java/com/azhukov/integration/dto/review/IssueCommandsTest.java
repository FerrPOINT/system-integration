package com.azhukov.integration.dto.review;

import com.azhukov.integration.domain.RuleViolation;
import com.azhukov.integration.domain.review.IssueResolution;
import java.util.UUID;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class IssueCommandsTest {
    @Test
    void bothDecisionsRequireAnActualReason() {
        var reconciliation=UUID.randomUUID();
        for (var reason:new String[]{null,""," \n\t","\u2003","\u00a0","\u3000","x".repeat(501)}) {
            assertEquals(RuleViolation.Code.VALIDATION_FAILED,
                assertThrows(RuleViolation.class,() -> new IssueCommands.Retry(1,reason,reconciliation)).code());
            assertEquals(RuleViolation.Code.VALIDATION_FAILED,
                assertThrows(RuleViolation.class,() -> new IssueCommands.Resolve(1,reconciliation,
                    IssueResolution.Action.APPLY_EXTERNAL_RESULT,reason)).code());
        }
    }

    @Test
    void meaningfulReasonIsPreservedExactly() {
        var reconciliation=UUID.randomUUID();
        for (var reason:new String[]{"Проверено\u2003оператором","x".repeat(500)}) {
            assertEquals(reason,new IssueCommands.Retry(1,reason,reconciliation).reason());
            assertEquals(reason,new IssueCommands.Resolve(1,reconciliation,
                IssueResolution.Action.ACKNOWLEDGE_DIFFERENCE,reason).reason());
        }
    }
}
