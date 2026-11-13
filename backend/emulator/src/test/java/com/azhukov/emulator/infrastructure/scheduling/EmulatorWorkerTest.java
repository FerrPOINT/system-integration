package com.azhukov.emulator.infrastructure.scheduling;

import com.azhukov.emulator.application.OperationService;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class EmulatorWorkerTest {
    @Test
    void batchSizeDoesNotIncreaseTheHundredEventCycleLimit() {
        var operations=mock(OperationService.class);
        when(operations.publish(anyInt())).thenAnswer(call -> call.getArgument(0));
        new EmulatorWorker(operations,25).publish();
        verify(operations,times(4)).publish(25);
        verifyNoMoreInteractions(operations);
    }
    @Test
    void anEmptyBatchStopsAndUnsupportedConfigurationFailsExplicitly() {
        var operations=mock(OperationService.class);
        new EmulatorWorker(operations,50).publish();
        verify(operations).publish(50);
        verifyNoMoreInteractions(operations);
        assertThrows(IllegalArgumentException.class,() -> new EmulatorWorker(operations,0));
        assertThrows(IllegalArgumentException.class,() -> new EmulatorWorker(operations,101));
    }
}
