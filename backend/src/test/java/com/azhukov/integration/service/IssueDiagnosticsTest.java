package com.azhukov.integration.service;

import com.azhukov.integration.client.ExternalExchangeClient.ProtocolEvidence;
import com.azhukov.integration.domain.review.Evidence;
import com.azhukov.integration.domain.review.Issue;
import com.azhukov.integration.repository.ReviewRepository;
import com.azhukov.integration.repository.TaskRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class IssueDiagnosticsTest {
    @Test
    void diagnosticDetailDoesNotChangeTheCanonicalFingerprintInputsOrStoredShape() {
        var repository=mock(ReviewRepository.class);
        var id=UUID.randomUUID();var operation=UUID.randomUUID();
        when(repository.open(any(),any(),any(),any(),any(),any())).thenReturn(new ReviewRepository.Opened(id,false));
        var service=new IssueLifecycleService(repository,mock(TaskRepository.class));
        var raw=java.util.Map.of("quantity","not-an-integer");
        String canonical="Входящий снимок не соответствует контракту";
        assertEquals(id,service.open(null,operation,Issue.Kind.RESULT_CONFLICT,canonical,
            new ProtocolEvidence(raw,"FIELD_TYPE at quantity"),null,7L));
        var evidence=ArgumentCaptor.forClass(Evidence.class);
        verify(repository).open(isNull(),eq(operation),eq(Issue.Kind.RESULT_CONFLICT),eq(canonical),same(raw),evidence.capture());
        assertEquals(canonical+" [FIELD_TYPE at quantity]",evidence.getValue().reason());
        assertEquals(7L,evidence.getValue().cursor());assertNull(evidence.getValue().received());
    }
}
