package com.azhukov.integration.repository.springdata;

/** Negative architecture fixture: a read adapter cannot acquire a direct SQL executor. */
class JdbcLeakFixture {
    org.springframework.jdbc.core.JdbcTemplate jdbc;
}
