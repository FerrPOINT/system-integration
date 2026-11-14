package com.azhukov.emulator.scheduler;

import com.azhukov.emulator.service.OperationService;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

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
    void aNonDivisibleBatchUsesOnlyTheRemainingCycleCapacity() {
        var operations=mock(OperationService.class);
        when(operations.publish(anyInt())).thenAnswer(call -> call.getArgument(0));
        new EmulatorWorker(operations,30).publish();
        var ordered=inOrder(operations);
        ordered.verify(operations,times(3)).publish(30);
        ordered.verify(operations).publish(10);
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
