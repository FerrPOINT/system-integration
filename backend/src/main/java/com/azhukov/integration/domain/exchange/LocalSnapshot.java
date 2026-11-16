package com.azhukov.integration.domain.exchange;

import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.domain.task.DeliveryStatus;
import com.azhukov.integration.domain.task.TaskInput;
import com.azhukov.integration.domain.task.TaskOutcome;

/** Immutable evidence; intentionally excludes the unrelated title revision. */
public record LocalSnapshot(
        TaskInput request,
        DeliveryStatus deliveryStatus,
        BusinessStatus businessStatus,
        Integer resultVersion,
        TaskOutcome result) {
    public static LocalSnapshot of(ExchangeState state) {
        return new LocalSnapshot(
                state.task().request(),
                state.task().deliveryStatus(),
                state.task().businessStatus(),
                state.result() == null ? null : state.result().version(),
                state.task().outcome());
    }
}
