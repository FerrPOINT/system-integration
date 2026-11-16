package com.azhukov.integration.dto.review;

import com.azhukov.integration.domain.review.Issue;

/** Current task labels enrich reads without changing durable issue/command receipts. */
public record IssueView(Issue issue, String requestReference, String taskTitle) {}
