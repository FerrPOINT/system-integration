package com.azhukov.integration.support;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import java.util.concurrent.Callable;
import javax.sql.DataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/**
 * Test-only observation at the driver boundary, including generated Spring Data SQL.
 * Recording is explicitly scoped to synthetic task/history SELECTs on the test thread.
 * Authentication, writes, passwords and ordinary application traffic are never recorded.
 */
@TestConfiguration(proxyBeanMethods = false)
public class ReadSqlCapture {
    private static final ThreadLocal<Trace> ACTIVE = new ThreadLocal<>();

    public record Parameter(int index, String setter, String javaType, String postgresType, String value) {}

    public record Statement(String sql, List<Parameter> parameters) {}

    public record Captured<T>(T value, List<Statement> statements) {}

    private static class Trace {
        final List<Statement> statements = new ArrayList<>();
        Runnable afterSelect;

        Trace(Runnable hook) {
            afterSelect = hook;
        }
    }

    public static <T> Captured<T> record(Callable<T> work) throws Exception {
        return record(work, null);
    }

    /** The optional hook runs after the first SELECT, for snapshot concurrency checks. */
    public static <T> Captured<T> record(Callable<T> work, Runnable afterSelect) throws Exception {
        if (ACTIVE.get() != null) throw new IllegalStateException("Nested SQL capture");
        var trace = new Trace(afterSelect);
        ACTIVE.set(trace);
        try {
            return new Captured<>(work.call(), List.copyOf(trace.statements));
        } finally {
            ACTIVE.remove();
        }
    }

    @Bean
    static BeanPostProcessor capturePreparedReads() {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String name) {
                return bean instanceof DataSource source ? new ObservedDataSource(source) : bean;
            }
        };
    }

    private static class ObservedDataSource extends DelegatingDataSource implements AutoCloseable {
        ObservedDataSource(DataSource source) {
            super(source);
        }

        @Override
        public Connection getConnection() throws SQLException {
            return connection(super.getConnection());
        }

        @Override
        public Connection getConnection(String user, String password) throws SQLException {
            return connection(super.getConnection(user, password));
        }

        @Override
        public void close() throws Exception {
            if (getTargetDataSource() instanceof AutoCloseable closeable) closeable.close();
        }
    }

    private static Connection connection(Connection delegate) {
        return (Connection)
                Proxy.newProxyInstance(
                        ReadSqlCapture.class.getClassLoader(),
                        new Class<?>[] {Connection.class},
                        (proxy, method, args) -> {
                            try {
                                Object value = method.invoke(delegate, args);
                                if (method.getName().equals("prepareStatement")
                                        && args[0] instanceof String sql
                                        && value instanceof PreparedStatement statement)
                                    return statement(statement, sql);
                                return value;
                            } catch (InvocationTargetException error) {
                                throw error.getCause();
                            }
                        });
    }

    private static PreparedStatement statement(PreparedStatement delegate, String sql) {
        var bindings = new TreeMap<Integer, Parameter>();
        return (PreparedStatement)
                Proxy.newProxyInstance(
                        ReadSqlCapture.class.getClassLoader(),
                        new Class<?>[] {PreparedStatement.class},
                        (proxy, method, args) -> {
                            try {
                                Object value = method.invoke(delegate, args);
                                if (ACTIVE.get() == null) return value;
                                if (method.getName().startsWith("set")
                                        && args != null
                                        && args.length >= 2
                                        && args[0] instanceof Integer index) {
                                    Object parameter = method.getName().equals("setNull") ? null : args[1];
                                    bindings.put(
                                            index,
                                            new Parameter(
                                                    index,
                                                    method.getName(),
                                                    parameter == null ? "null" : parameter.getClass().getName(),
                                                    null,
                                                    parameter == null ? null : parameter.toString()));
                                }
                                if (method.getName().equals("executeQuery")
                                        && sql.stripLeading().toUpperCase(java.util.Locale.ROOT).startsWith("SELECT")
                                        && sql.matches("(?is).*FROM\\s+\"?(tasks|task_history)\"?.*")) {
                                    var metadata = delegate.getParameterMetaData();
                                    var parameters = new ArrayList<Parameter>();
                                    for (var binding : bindings.values())
                                        parameters.add(
                                                new Parameter(
                                                        binding.index(),
                                                        binding.setter(),
                                                        binding.javaType(),
                                                        metadata.getParameterTypeName(binding.index()),
                                                        binding.value()));
                                    var trace = ACTIVE.get();
                                    trace.statements.add(
                                            new Statement(
                                                    sql.strip().replaceAll("\\s+", " "), List.copyOf(parameters)));
                                    var hook = trace.afterSelect;
                                    trace.afterSelect = null;
                                    if (hook != null) hook.run();
                                }
                                return value;
                            } catch (InvocationTargetException error) {
                                throw error.getCause();
                            }
                        });
    }
}
