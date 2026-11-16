package com.azhukov.emulator.controller;

import com.azhukov.emulator.repository.OperationRepository;
import org.springframework.jdbc.core.JdbcTemplate;

public class ControllerBoundaryFixture {
    public static class RepositoryAccess {
        private OperationRepository operations;
    }

    public static class SqlAccess {
        private JdbcTemplate jdbc;
    }
}
