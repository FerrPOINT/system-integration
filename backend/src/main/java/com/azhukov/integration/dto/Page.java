package com.azhukov.integration.dto;

import com.azhukov.integration.domain.RuleViolation;
import java.util.List;

public record Page<T>(List<T> items, int page, int size, long totalItems) {
    public static final int MAX_SIZE = 100;
    public Page { requireValid(page,size); items = List.copyOf(items); }
    public static void requireValid(int page,int size) {
        if (page < 0) throw RuleViolation.invalid("Номер страницы не может быть отрицательным");
        if (size < 1 || size > MAX_SIZE) throw RuleViolation.invalid("Размер страницы должен быть от 1 до 100");
    }
    public long totalPages() { return (totalItems + size - 1) / size; }
    public boolean hasNext() { return (long) page + 1 < totalPages(); }
}
