package com.azhukov.emulator.scheduler;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.azhukov.emulator.service.OperationService;
import org.junit.jupiter.api.Test;

class EmulatorWorkerTest {
    @Test
    void executionBatchesKeepTheFiftyOperationPassBoundAndRemainder() {
        var operations = mock(OperationService.class);
        when(operations.executeNext(anyInt())).thenAnswer(call -> call.getArgument(0));
        new EmulatorWorker(operations, 25, 12).execute();
        var ordered = inOrder(operations);
        ordered.verify(operations, times(4)).executeNext(12);
        ordered.verify(operations).executeNext(2);
        verifyNoMoreInteractions(operations);
    }

    @Test
    void emptyExecutionStopsAndInvalidSizesAreRejected() {
        var operations = mock(OperationService.class);
        new EmulatorWorker(operations, 25, 5).execute();
        verify(operations).executeNext(5);
        verifyNoMoreInteractions(operations);
        for (int invalid : new int[] {0, -1, 26})
            assertThrows(IllegalArgumentException.class, () -> new EmulatorWorker(operations, 25, invalid));
    }

    @Test
    void batchSizeDoesNotIncreaseTheHundredEventCycleLimit() {
        var operations = mock(OperationService.class);
        when(operations.publish(anyInt())).thenAnswer(call -> call.getArgument(0));
        new EmulatorWorker(operations, 25, 5).publish();
        verify(operations, times(4)).publish(25);
        verifyNoMoreInteractions(operations);
    }

    @Test
    void aNonDivisibleBatchUsesOnlyTheRemainingCycleCapacity() {
        var operations = mock(OperationService.class);
        when(operations.publish(anyInt())).thenAnswer(call -> call.getArgument(0));
        new EmulatorWorker(operations, 30, 5).publish();
        var ordered = inOrder(operations);
        ordered.verify(operations, times(3)).publish(30);
        ordered.verify(operations).publish(10);
        verifyNoMoreInteractions(operations);
    }

    @Test
    void anEmptyBatchStopsAndUnsupportedConfigurationFailsExplicitly() {
        var operations = mock(OperationService.class);
        new EmulatorWorker(operations, 50, 5).publish();
        verify(operations).publish(50);
        verifyNoMoreInteractions(operations);
        assertThrows(IllegalArgumentException.class, () -> new EmulatorWorker(operations, 0, 5));
        assertThrows(IllegalArgumentException.class, () -> new EmulatorWorker(operations, 101, 5));
    }
}
