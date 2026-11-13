package com.azhukov.integration.domain.review;

import com.azhukov.integration.domain.exchange.LocalSnapshot;
import com.azhukov.integration.domain.exchange.OperationResult;

/** Sparse diagnostic evidence is valid; historical feed issues can contain an empty document. */
public record Evidence(String reason, Long cursor, LocalSnapshot local, OperationResult received) {}
