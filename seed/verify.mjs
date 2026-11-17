import assert from 'node:assert/strict';
import { ApiSession, ApiFailure, parallel } from '../tests/support/http.mjs';
import { generalIssues, TASK_COUNT } from './catalog.mjs';
import { literal } from './postgres.mjs';

/** Verify served domain objects, not only SQL row counts or fixture JSON. */
export async function verify(db, model, { fresh = false } = {}) {
  if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required for API verification');
  const api = new ApiSession('http://127.0.0.1:19680');
  await api.login('operator', process.env.SI_DEMO_PASSWORD);
  const summary = { tasks: 0, operations: 0, issues: 0, reconciliations: 0, histories: 0, roles: false };
  const actualTasks = new Map();
  await parallel(model.rows.tasks, 6, async (expected) => {
    const task = await api.get('/api/tasks/' + expected.id);
    assert.equal(task.ownerId, expected.owner_id);
    assert.equal(task.operationId, expected.operation_id);
    assert.equal(task.request.reference, expected.request_reference);
    assert.equal(task.request.quantity, expected.request_quantity);
    if (fresh) {
      assert.equal(task.deliveryStatus, expected.delivery_status);
      assert.equal(task.businessStatus, expected.business_status);
    }
    actualTasks.set(task.taskId, task);
    summary.tasks++;
  });
  assert.equal(summary.tasks, TASK_COUNT);
  console.log(`Verified ${summary.tasks} task cards.`);
  await parallel(model.rows.operations, 6, async (expected) => {
    const response = await fetch('http://127.0.0.1:19681/operations/' + expected.id, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.operationId, expected.id);
    assert.equal(value.request.reference, expected.reference);
    assert.equal(value.executions, 1);
    assert.equal(value.result.status, expected.result.status);
    summary.operations++;
  });
  console.log(`Verified ${summary.operations} external operations.`);
  const issues = new Map();
  await parallel(model.rows.exchange_issues, 6, async (expected) => {
    const issue = await api.get('/api/exchange/issues/' + expected.id);
    assert.equal(issue.issueId, expected.id);
    assert.equal(issue.taskId ?? null, expected.task_id);
    if (fresh) {
      assert.equal(issue.status, expected.status);
      assert.equal(issue.kind, expected.kind);
      assert.equal(issue.assignedTo ?? null, expected.assigned_to);
      if (expected.resolution) {
        for (const field of ['issueId', 'action', 'reason', 'decidedBy'])
          assert.equal(issue.resolution[field], expected.resolution[field]);
        assert.equal(issue.resolution.reconciliationId ?? null, expected.resolution.reconciliationId);
        assert.equal(Date.parse(issue.resolution.decidedAt), Date.parse(expected.resolution.decidedAt));
      } else assert.equal(issue.resolution ?? null, null);
    }
    if (issue.status === 'RESOLVED') assert.deepEqual(issue.allowedActions, []);
    issues.set(issue.issueId, issue);
    summary.issues++;
  });
  console.log(`Verified ${summary.issues} issue cards.`);
  await parallel(model.rows.reconciliations, 6, async (expected) => {
    const value = await api.get(`/api/tasks/${expected.task_id}/reconciliations/${expected.id}`);
    assert.equal(value.reconciliationId, expected.id);
    assert.equal(value.taskId, expected.task_id);
    assert.equal(value.outcome, expected.snapshot.outcome);
    assert.equal(value.externalAvailability, expected.snapshot.externalAvailability);
    summary.reconciliations++;
  });
  console.log(`Verified ${summary.reconciliations} saved reconciliations.`);
  // Every history page is deserialized by the same read endpoint used by the UI.
  await parallel(model.rows.tasks, 6, async (task) => {
    let loaded = 0;
    for (let page = 0; ; page++) {
      const history = await api.get(`/api/tasks/${task.id}/history?size=100&page=${page}`);
      assert.equal(history.totalPages, Math.ceil(history.totalItems / 100));
      assert.ok(history.items.every((event) => event.taskId === task.id));
      loaded += history.items.length;
      if (!history.hasNext) {
        assert.equal(loaded, history.totalItems);
        break;
      }
    }
    assert.ok(loaded >= model.rows.task_history.filter((event) => event.task_id === task.id).length);
    summary.histories++;
  });
  console.log(`Verified ${summary.histories} complete histories.`);
  for (const status of [null, 'SUCCEEDED', 'REJECTED', 'PENDING', 'RUNNING']) {
    const page = await api.get('/api/tasks?size=20' + (status ? '&businessStatus=' + status : ''));
    assert.equal(page.totalPages, Math.ceil(page.totalItems / 20));
    assert.ok(page.items.length > 0);
    if (status) assert.ok(page.items.every((task) => task.businessStatus === status));
  }
  for (const status of ['OPEN', 'RESOLVED']) {
    const page = await api.get('/api/exchange/issues?size=20&status=' + status);
    assert.ok(page.items.length > 0);
    assert.ok(page.items.every((issue) => issue.status === status));
  }
  const first = actualTasks.get(model.rows.tasks[0].id);
  const range = await api.get(
    '/api/tasks?size=20&createdFrom=' +
      encodeURIComponent(first.createdAt) +
      '&createdTo=' +
      encodeURIComponent(new Date(Date.parse(first.createdAt) + 1).toISOString()),
  );
  assert.ok(range.totalItems > 0);
  assert.ok(range.items.every((task) => Date.parse(task.createdAt) === Date.parse(first.createdAt)));
  const ownerCounts = db.read(
    'si_test',
    `SELECT jsonb_object_agg(username,n) FROM (SELECT u.username,count(*) n FROM tasks t JOIN users u ON u.id=t.owner_id WHERE t.id IN (${model.rows.tasks.map((task) => literal(task.id)).join(',')}) GROUP BY u.username) counts;`,
  );
  assert.deepEqual(ownerCounts, { 'initiator.one': 600, 'initiator.two': 600 });
  for (const name of ['initiator.one', 'initiator.two']) {
    const user = new ApiSession('http://127.0.0.1:19680');
    const identity = await user.login(name, process.env.SI_DEMO_PASSWORD);
    const page = await user.get('/api/tasks?size=20');
    assert.ok(page.items.every((task) => task.ownerId === identity.userId));
    const other = model.rows.tasks.find((task) => task.owner_id !== identity.userId);
    await assert.rejects(
      user.get('/api/tasks/' + other.id),
      (error) => error instanceof ApiFailure && error.status === 404,
    );
    await assert.rejects(
      user.get('/api/exchange/issues/' + generalIssues[0].issueId),
      (error) => error instanceof ApiFailure && error.status === 403,
    );
  }
  if (fresh) {
    const example = (scenario) => issues.get(model.examples.find((item) => item.scenario === scenario).issueId);
    assert.ok(example('retry').allowedActions.includes('RETRY'));
    assert.ok(example('difference').allowedActions.includes('APPLY_EXTERNAL_RESULT'));
    assert.ok(!example('protocol').allowedActions.includes('APPLY_EXTERNAL_RESULT'));
    assert.ok(!example('stale').allowedActions.includes('ACKNOWLEDGE_DIFFERENCE'));
    assert.deepEqual(issues.get(generalIssues[0].issueId).allowedActions, ['ACKNOWLEDGE_FEED_ISSUE']);
  }
  summary.roles = true;
  return summary;
}
