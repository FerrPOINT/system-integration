package com.azhukov.integration.application;

import java.util.List;

public record Page<T>(List<T> items, int page, long totalItems) {
    public static final int SIZE = 20;
    public Page { items = List.copyOf(items); }
    public long totalPages() { return (totalItems + SIZE - 1) / SIZE; }
    public boolean hasNext() { return (long) page + 1 < totalPages(); }
}
