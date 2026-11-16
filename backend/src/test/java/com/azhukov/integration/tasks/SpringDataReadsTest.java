package com.azhukov.integration.tasks;

import static org.junit.jupiter.api.Assertions.*;

import com.azhukov.integration.domain.Actor;
import com.azhukov.integration.domain.task.BusinessStatus;
import com.azhukov.integration.service.TaskService;
import com.azhukov.integration.support.PostgresTest;
import com.azhukov.integration.support.ReadSqlCapture;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;

@Import(ReadSqlCapture.class)
class SpringDataReadsTest extends PostgresTest {
    @Autowired TaskService tasks;
    @Autowired ApplicationContext context;

    @Test
    void oneBootDataSourceAndTransactionManagerAreShared() {
        assertEquals(1, context.getBeansOfType(DataSource.class).size());
        assertEquals(1, context.getBeansOfType(PlatformTransactionManager.class).size());
        assertFalse(context.containsBean("entityManagerFactory"));
    }

    @Test
    void filtersAndExactCountsUseTheSameOwnershipAndHalfOpenUtcRules() throws Exception {
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        var fixtures = new ArrayList<Fixture>();
        int n = 0;
        for (UUID owner : List.of(first, second))
            for (BusinessStatus status : BusinessStatus.values())
                for (int secondOffset = 0; secondOffset < 3; secondOffset++) {
                    var id = UUID.randomUUID();
                    var createdAt = at.plusSeconds(secondOffset);
                    insert(id, owner, status, createdAt);
                    fixtures.add(new Fixture(id, owner, status, createdAt));
                }
        for (Actor actor :
                List.of(
                        new Actor(first, Actor.Role.INITIATOR),
                        new Actor(second, Actor.Role.INITIATOR),
                        new Actor(operator, Actor.Role.OPERATOR))) {
            var statuses = new ArrayList<BusinessStatus>();
            statuses.add(null);
            statuses.addAll(List.of(BusinessStatus.values()));
            for (var status : statuses)
                for (var lower : List.of(false, true))
                    for (var upper : List.of(false, true)) {
                        var from = lower ? at.plusSeconds(1) : null;
                        var to = upper ? at.plusSeconds(2) : null;
                        var expected =
                                fixtures.stream()
                                        .filter(f -> actor.isOperator() || f.owner().equals(actor.id()))
                                        .filter(f -> status == null || f.status() == status)
                                        .filter(f -> from == null || !f.at().isBefore(from))
                                        .filter(f -> to == null || f.at().isBefore(to))
                                        .map(Fixture::id)
                                        .sorted(java.util.Comparator.reverseOrder())
                                        .toList();
                        var all = new ArrayList<UUID>();
                        for (int page = 0; page < 4; page++) {
                            var result = tasks.list(actor, page, 7, status, from, to);
                            assertEquals(expected.size(), result.totalItems());
                            all.addAll(
                                    result.items().stream().map(com.azhukov.integration.domain.task.Task::id).toList());
                        }
                        assertEquals(expected.size(), all.size());
                        assertEquals(new java.util.HashSet<>(expected), new java.util.HashSet<>(all));
                        n++;
                    }
        }
        assertEquals(60, n);
    }

    @Test
    void subMicrosecondFilterBoundsKeepHalfOpenSemantics() {
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        var fixtures = new ArrayList<Fixture>();
        for (UUID owner : List.of(first, second))
            for (int nanos : List.of(0, 1000, 2000)) {
                var id = UUID.randomUUID();
                insert(id, owner, BusinessStatus.PENDING, at.plusNanos(nanos));
                fixtures.add(new Fixture(id, owner, BusinessStatus.PENDING, at.plusNanos(nanos)));
            }
        for (Actor actor : List.of(new Actor(first, Actor.Role.INITIATOR), new Actor(operator, Actor.Role.OPERATOR))) {
            for (int nanos : List.of(0, 1, 499, 500, 999, 1000, 1001, 1500, 2000))
                for (boolean lower : List.of(false, true)) {
                    var bound = at.plusNanos(nanos);
                    var expected =
                            fixtures.stream()
                                    .filter(f -> actor.isOperator() || f.owner().equals(actor.id()))
                                    .filter(f -> lower ? !f.at().isBefore(bound) : f.at().isBefore(bound))
                                    .map(Fixture::id)
                                    .collect(java.util.stream.Collectors.toSet());
                    var result = tasks.list(actor, 0, 20, null, lower ? bound : null, lower ? null : bound);
                    assertEquals(
                            expected,
                            result.items().stream()
                                    .map(com.azhukov.integration.domain.task.Task::id)
                                    .collect(java.util.stream.Collectors.toSet()),
                            "nanos=" + nanos + ", lower=" + lower);
                    assertEquals(expected.size(), result.totalItems());
                }
            var empty = tasks.list(actor, 0, 20, null, at.plusNanos(1), at.plusNanos(2));
            assertEquals(0, empty.totalItems());
            assertTrue(empty.items().isEmpty());
        }
    }

    @Test
    void subMicrosecondBoundsCanCarryAcrossTheLastSupportedUtcYear() {
        var at = OffsetDateTime.parse("9999-12-31T23:59:59.999999Z");
        var id = UUID.randomUUID();
        insert(id, first, BusinessStatus.PENDING, at);
        var actor = new Actor(first, Actor.Role.INITIATOR);
        assertEquals(1, tasks.list(actor, 0, 20, null, null, at.plusNanos(1)).totalItems());
        assertEquals(0, tasks.list(actor, 0, 20, null, at.plusNanos(1), null).totalItems());
        assertEquals(0, tasks.list(actor, 0, 20, null, at.plusNanos(1), at.plusNanos(999)).totalItems());
    }

    @Test
    void countAndRowsStayOnOneSnapshotDuringConcurrentCommit() throws Exception {
        var actor = new Actor(first, Actor.Role.INITIATOR);
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        insert(UUID.randomUUID(), first, BusinessStatus.PENDING, at);
        var read =
                ReadSqlCapture.record(
                        () -> tasks.list(actor, 0, 20, null, null, null),
                        () ->
                                CompletableFuture.runAsync(
                                                () -> insert(UUID.randomUUID(), first, BusinessStatus.PENDING, at))
                                        .join());
        assertEquals(1, read.value().items().size());
        assertEquals(1, read.value().totalItems());
        assertEquals(2, tasks.list(actor, 0, 20, null, null, null).totalItems());
        assertEquals(2, read.statements().size(), "One generated SELECT and one COUNT; no hidden aggregate queries");
    }

    @Test
    void capturesEveryGeneratedFilterShapeAndActualDriverParameterTypes() throws Exception {
        UUID owner = uid(900001), task = uid(1);
        jdbc.update("INSERT INTO users VALUES (?,?,?,?)", owner, "sql.owner.one", "not-a-login-secret", "INITIATOR");
        insert(task, owner, BusinessStatus.PENDING, OffsetDateTime.parse("2026-01-01T00:00:01Z"));
        var cases = new ArrayList<Map<String, Object>>();
        var statuses = new ArrayList<BusinessStatus>();
        statuses.add(null);
        statuses.addAll(List.of(BusinessStatus.values()));
        for (boolean op : List.of(false, true))
            for (var status : statuses)
                for (boolean lower : List.of(false, true))
                    for (boolean upper : List.of(false, true))
                        for (int page : List.of(0, 450, 1000)) {
                            var actor =
                                    new Actor(op ? operator : owner, op ? Actor.Role.OPERATOR : Actor.Role.INITIATOR);
                            var read =
                                    ReadSqlCapture.record(() ->
                                            tasks.list(
                                                    actor,
                                                    page,
                                                    20,
                                                    status,
                                                    lower ? OffsetDateTime.parse("2025-12-01T00:00:00Z") : null,
                                                    upper ? OffsetDateTime.parse("2027-01-01T00:00:00Z") : null));
                            assertEquals(2, read.statements().size());
                            cases.add(
                                    Map.of(
                                            "scenario",
                                            "operator="
                                                    + op
                                                    + ",status="
                                                    + status
                                                    + ",from="
                                                    + lower
                                                    + ",to="
                                                    + upper
                                                    + ",page="
                                                    + page,
                                            "statements",
                                            read.statements()));
                        }
        for (boolean op : List.of(false, true)) {
            var actor = new Actor(op ? operator : owner, op ? Actor.Role.OPERATOR : Actor.Role.INITIATOR);
            var read = ReadSqlCapture.record(() -> tasks.get(actor, task));
            assertEquals(1, read.statements().size());
            cases.add(Map.of("scenario", "card,operator=" + op, "statements", read.statements()));
            for (int page : List.of(0, 50))
                for (int size : List.of(1, 7, 20, 100)) {
                    var history = ReadSqlCapture.record(() -> tasks.history(actor, task, page, size));
                    assertEquals(3, history.statements().size(), "Visibility check, bounded history SELECT and COUNT");
                    cases.add(
                            Map.of(
                                    "scenario",
                                    "history,operator=" + op + ",page=" + page + ",size=" + size,
                                    "statements",
                                    history.statements()));
                }
        }
        for (UUID actorId : List.of(uid(900002), uid(999999)))
            for (var status : statuses) {
                var read =
                        ReadSqlCapture.record(
                                () -> tasks.list(new Actor(actorId, Actor.Role.INITIATOR), 0, 20, status, null, null));
                cases.add(
                        Map.of(
                                "scenario",
                                "minority-or-missing-owner=" + actorId + ",status=" + status,
                                "statements",
                                read.statements()));
            }
        for (boolean op : List.of(false, true))
            for (String start : List.of("2026-01-01T01:00:00Z", "2030-01-01T00:00:00Z")) {
                var from = OffsetDateTime.parse(start);
                var read =
                        ReadSqlCapture.record(() ->
                                tasks.list(
                                        new Actor(
                                                op ? operator : owner, op ? Actor.Role.OPERATOR : Actor.Role.INITIATOR),
                                        0,
                                        20,
                                        null,
                                        from,
                                        from.plusSeconds(20)));
                cases.add(
                        Map.of(
                                "scenario",
                                "narrow-or-empty-window=" + start + ",operator=" + op,
                                "statements",
                                read.statements()));
            }
        for (int size : List.of(1, 7, 100)) {
            var read =
                    ReadSqlCapture.record(
                            () -> tasks.list(new Actor(operator, Actor.Role.OPERATOR), 0, size, null, null, null));
            cases.add(Map.of("scenario", "registry-size=" + size, "statements", read.statements()));
        }
        for (var captured : cases) {
            @SuppressWarnings("unchecked")
            var statements = (List<ReadSqlCapture.Statement>) captured.get("statements");
            for (var statement : statements)
                for (var parameter : statement.parameters()) assertNotNull(parameter.postgresType());
        }
        var target = Path.of("../tests/results/spring-data-read/generated-sql.json");
        Files.createDirectories(target.getParent());
        var sources = new java.util.TreeMap<String, String>();
        var root = Path.of("..").toAbsolutePath().normalize();
        try (var paths = Files.walk(root.resolve("backend/src/main/java/com/azhukov/integration/repository"))) {
            for (var source : paths.filter(p -> p.toString().endsWith(".java")).toList())
                sources.put(
                        root.relativize(source).toString(),
                        java.util.HexFormat.of()
                                .formatHex(
                                        java.security.MessageDigest.getInstance("SHA-256")
                                                .digest(Files.readAllBytes(source))));
        }
        Files.writeString(
                target,
                json.writerWithDefaultPrettyPrinter()
                        .writeValueAsString(
                                Map.of(
                                        "database",
                                        "si_test",
                                        "syntheticParametersOnly",
                                        true,
                                        "sources",
                                        sources,
                                        "cases",
                                        cases)));
    }

    @Test
    void historyMapsAllEventKindsAndReferencesInStableBoundedPages() throws Exception {
        var task = UUID.randomUUID();
        var at = OffsetDateTime.parse("2026-11-10T12:00:00Z");
        insert(task, first, BusinessStatus.PENDING, at);
        var operation = jdbc.queryForObject("SELECT operation_id FROM tasks WHERE id=?", UUID.class, task);
        var refs =
                Map.of(
                        "attemptId",
                        uid(70),
                        "resultVersion",
                        2,
                        "issueId",
                        uid(71),
                        "reconciliationId",
                        uid(72),
                        "previousAssigneeId",
                        first,
                        "assignedTo",
                        operator);
        var kinds = com.azhukov.integration.domain.task.HistoryType.values();
        for (int n = 0; n < kinds.length; n++)
            jdbc.update(
                    """
                    INSERT INTO task_history(id,task_id,operation_id,occurred_at,actor,actor_user_id,event_type,summary,details)
                    VALUES (?,?,?,?,'USER',?,?,?,?::jsonb)
                    """,
                    uid(100 + n),
                    task,
                    operation,
                    at,
                    first,
                    kinds[n].name(),
                    "Details fixture",
                    json.writeValueAsString(refs));
        for (int page = 0; page < kinds.length; page++) {
            var result = tasks.history(new Actor(first, Actor.Role.INITIATOR), task, page, 1);
            assertEquals(kinds.length, result.totalItems());
            assertEquals(1, result.items().size());
            var entry = result.items().getFirst();
            assertEquals(uid(100 + kinds.length - 1 - page), entry.eventId());
            assertEquals(kinds[kinds.length - 1 - page], entry.type());
            assertEquals(first, entry.actorUserId());
            assertEquals("initiator.one", entry.actorUsername());
            assertEquals(at.toInstant(), entry.occurredAt().toInstant());
            assertEquals(uid(70), entry.attemptId());
            assertEquals(2, entry.resultVersion());
            assertEquals(uid(71), entry.issueId());
            assertEquals(uid(72), entry.reconciliationId());
            assertEquals(first, entry.previousAssigneeId());
            assertEquals(operator, entry.assignedTo());
        }
        assertTrue(tasks.history(new Actor(operator, Actor.Role.OPERATOR), task, kinds.length, 1).items().isEmpty());
    }

    private UUID uid(int n) {
        return UUID.fromString("00000000-0000-0000-0000-" + String.format("%012d", n));
    }

    private void insert(UUID id, UUID owner, BusinessStatus status, OffsetDateTime at) {
        jdbc.update(
                """
                INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,business_status,created_at)
                VALUES (?,?,?,'Read fixture','REQ-000001',25,?,?)
                """,
                id,
                owner,
                UUID.randomUUID(),
                status.name(),
                at);
    }

    private record Fixture(UUID id, UUID owner, BusinessStatus status, OffsetDateTime at) {}
}
