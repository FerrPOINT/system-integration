package com.azhukov.integration.dto.exchange;

import java.time.OffsetDateTime;

/** Queue projection, including parked deliveries; oldestCreatedAt is null when the queue is empty. */
public record DeliveryBacklog(long operations, OffsetDateTime oldestCreatedAt) {}
