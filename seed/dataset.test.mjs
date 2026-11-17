import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, id, SCENARIOS, TASK_COUNT } from './catalog.mjs';
import { dataset } from './dataset.mjs';
import { insertion, insertDataset } from './postgres.mjs';

const users = { 'initiator.one': id('user/one'), 'initiator.two': id('user/two'), operator: id('user/operator') };
const model = dataset(users, '2026-11-16T00:00:00.000Z');
const { rows } = model;

test('large catalogue is balanced, diverse and stable across runs', () => {
  const items = catalog();
  assert.equal(items.length, TASK_COUNT);
  assert.equal(new Set(items.map((item) => item.taskId)).size, TASK_COUNT);
  assert.equal(new Set(items.map((item) => item.reference)).size, TASK_COUNT);
  assert.equal(new Set(items.map((item) => item.title)).size, TASK_COUNT);
  assert.equal(items.filter((item) => item.owner === 'initiator.one').length, 600);
  assert.equal(items.filter((item) => item.owner === 'initiator.two').length, 600);
  for (const scenario of SCENARIOS)
    for (const owner of ['initiator.one', 'initiator.two'])
      assert.ok(
        items.some((item) => item.scenario === scenario && item.owner === owner),
        `${scenario} for ${owner}`,
      );
  assert.deepEqual(catalog(), items);
  assert.ok(new Set(items.map((item) => item.quantity)).size >= 100);
});

test('persisted aggregates have valid cross-database identities and business outcomes', () => {
  const tasks = new Map(rows.tasks.map((row) => [row.id, row]));
  const operations = new Map(rows.operations.map((row) => [row.id, row]));
  assert.ok(new Set(rows.tasks.map((task) => task.created_at.slice(0, 10))).size >= 80);
  for (const task of tasks.values()) {
    assert.match(task.request_reference, /^REQ-\d{6}$/);
    assert.ok([...task.title].length <= 160);
    assert.ok(task.request_quantity >= 1 && task.request_quantity <= 1000);
    if (task.accepted_result) {
      assert.equal(task.accepted_result.status, task.business_status);
      assert.equal(task.accepted_result.operationId, task.operation_id);
      assert.deepEqual(task.accepted_result.request, {
        reference: task.request_reference,
        quantity: task.request_quantity,
      });
      if (task.business_status !== 'REJECTED')
        assert.equal(Object.hasOwn(task.accepted_result, 'rejectionCode'), false);
    }
    const queue = rows.delivery_queue.find((queue) => queue.operation_id === task.operation_id);
    assert.equal(Boolean(queue), task.delivery_status === 'NEEDS_REVIEW');
    if (queue) assert.equal(queue.due_at, 'infinity');
  }
  for (const operation of operations.values()) {
    assert.equal(operation.executions, 1);
    assert.equal(operation.result.operationId, operation.id);
    assert.equal(operation.result.request.reference, operation.reference);
    assert.equal(operation.result.status, operation.quantity > 100 ? 'REJECTED' : 'SUCCEEDED');
    assert.ok(Date.parse(operation.completed_at) >= Date.parse(operation.accepted_at));
  }
  for (const event of rows.result_events) {
    assert.ok(operations.has(event.operation_id));
    assert.equal(event.payload.operationId, event.operation_id);
    assert.equal(event.cursor, undefined); // Never invent or move the live publication cursor.
    assert.equal(event.publish_after, null);
  }
});

test('all issue, reconciliation, resolution and history variants have navigable references', () => {
  assert.deepEqual(
    new Set(rows.exchange_issues.map((row) => row.kind)),
    new Set([
      'DELIVERY_UNCERTAIN',
      'DELIVERY_DELAYED',
      'PROTOCOL_ERROR',
      'RESULT_CONFLICT',
      'RECONCILIATION_DIFFERENCE',
    ]),
  );
  assert.deepEqual(
    new Set(rows.reconciliations.map((row) => row.snapshot.outcome)),
    new Set(['MATCH', 'DIFFERENCE', 'UNAVAILABLE']),
  );
  assert.deepEqual(
    new Set(rows.reconciliations.map((row) => row.snapshot.externalAvailability)),
    new Set(['PRESENT', 'NOT_FOUND', 'UNAVAILABLE']),
  );
  assert.deepEqual(
    new Set(rows.exchange_issues.filter((row) => row.resolution).map((row) => row.resolution.action)),
    new Set(['APPLY_EXTERNAL_RESULT', 'ACKNOWLEDGE_DIFFERENCE', 'ACKNOWLEDGE_FEED_ISSUE']),
  );
  const issueIds = new Set(rows.exchange_issues.map((row) => row.id));
  const snapshots = new Map(rows.reconciliations.map((row) => [row.id, row]));
  for (const issue of rows.exchange_issues) {
    if (issue.latest_reconciliation_id)
      assert.equal(snapshots.get(issue.latest_reconciliation_id).task_id, issue.task_id);
    if (issue.resolution) {
      assert.equal(issue.status, 'RESOLVED');
      assert.equal(issue.resolution.decidedBy, users.operator);
    }
  }
  for (const event of rows.task_history) {
    assert.ok(
      Object.keys(event.details).every((key) =>
        ['attemptId', 'resultVersion', 'issueId', 'reconciliationId', 'previousAssigneeId', 'assignedTo'].includes(key),
      ),
    );
    if (event.details.issueId) assert.ok(issueIds.has(event.details.issueId));
    if (event.details.reconciliationId)
      assert.equal(snapshots.get(event.details.reconciliationId).task_id, event.task_id);
    assert.equal(event.actor === 'USER', event.actor_user_id !== null);
  }
  assert.deepEqual(
    new Set(rows.task_history.map((row) => row.event_type)),
    new Set([
      'CREATED',
      'RENAMED',
      'DELIVERY_ATTEMPT',
      'DELIVERY_ACKNOWLEDGED',
      'DELIVERY_UNCERTAIN',
      'RESULT_APPLIED',
      'RESULT_IGNORED',
      'ISSUE_OPENED',
      'RETRY_QUEUED',
      'RECONCILED',
      'ISSUE_RESOLVED',
      'RESPONSIBILITY_CHANGED',
    ]),
  );
  for (const item of model.examples.filter((item) => item.scenario === 'long'))
    assert.ok(rows.task_history.filter((row) => row.task_id === item.taskId).length > 120);
});

test('history never predates creation or announces a result before its completion', () => {
  for (const task of rows.tasks) {
    const history = rows.task_history.filter((event) => event.task_id === task.id);
    assert.ok(history.every((event) => Date.parse(event.occurred_at) >= Date.parse(task.created_at)));
    for (const event of history.filter(
      (event) => event.event_type === 'RESULT_APPLIED' && event.details.resultVersion === 2,
    ))
      assert.ok(Date.parse(event.occurred_at) >= Date.parse(task.accepted_result.completedAt));
  }
});

test('SQL is insert-only, preserves apostrophes and rejects arbitrary tables', () => {
  const sql = insertion('tasks', [{ ...rows.tasks[0], title: "Заявка O'Брайен" }]);
  assert.ok(sql.includes("O''Брайен"));
  assert.ok(!/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/.test(sql));
  assert.throws(() => insertion('users; DROP TABLE tasks', []), /Unsupported/);
});

test('repeating an imported dataset issues no inserts and preserves user-edited state', () => {
  const queries = [];
  const existing = {
    tasks: rows.tasks,
    operations: rows.operations,
    issues: rows.exchange_issues,
    faults: rows.faults,
  };
  const result = insertDataset({ query: (_database, sql) => queries.push(sql) }, model, existing);
  assert.deepEqual(result, { insertedTasks: 0, insertedIssues: 0 });
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(sql)));
});

test('recovery after the external commit inserts only the missing internal stage', () => {
  const queries = [];
  const existing = { tasks: [], operations: rows.operations, issues: [], faults: rows.faults };
  const result = insertDataset({ query: (database, sql) => queries.push({ database, sql }) }, model, existing);
  assert.equal(result.insertedTasks, 1200);
  assert.equal(result.insertedIssues, 150);
  assert.equal(queries[0].database, 'si_emulator_test');
  assert.ok(!queries[0].sql.includes('INSERT'));
  assert.equal(queries[1].database, 'si_test');
  assert.ok(queries[1].sql.includes('INSERT INTO tasks'));
});
