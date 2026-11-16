import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCreatedOperation, verifyTaskHistory, verifyFinishedSnapshot } from './integrity.mjs';

const expected = { taskId: 'task', ownerId: 'owner', title: 'Created task', reference: 'REQ-200001' };
const request = { reference: expected.reference, quantity: 25 };
const result = {
  operationId: 'operation',
  request,
  version: 2,
  status: 'SUCCEEDED',
  completedAt: '2026-11-13T00:00:01Z',
};
const task = {
  ...expected,
  request,
  operationId: 'operation',
  deliveryStatus: 'ACKNOWLEDGED',
  businessStatus: 'SUCCEEDED',
  createdAt: '2026-11-13T00:00:00Z',
  result: { status: 'SUCCEEDED', completedAt: result.completedAt },
};
const state = {
  operationId: 'operation',
  request: { ...request },
  executions: 1,
  result: { ...result, request: { ...request } },
};
const copy = (value) => structuredClone(value);

test('normal-mode verification proves the sent payload, owner and both final results', () => {
  assert.equal(verifyCreatedOperation(expected, task, 200, state, true).elapsedMs, 1000);
  const pending = { ...task, deliveryStatus: 'QUEUED', businessStatus: 'PENDING', result: undefined };
  assert.deepEqual(
    verifyCreatedOperation(expected, pending, 404, { status: 404, code: 'OPERATION_NOT_FOUND', title: 'Missing' }),
    { pending: true, notAccepted: true },
  );
  assert.throws(() =>
    verifyCreatedOperation(
      expected,
      pending,
      404,
      { status: 404, code: 'OPERATION_NOT_FOUND', title: 'Missing' },
      true,
    ),
  );
  assert.equal(
    verifyCreatedOperation(expected, { ...pending, deliveryStatus: 'ACKNOWLEDGED' }, 200, {
      ...state,
      executions: 0,
      result: null,
    }).pending,
    true,
  );
  assert.equal(
    verifyCreatedOperation(expected, pending, 200, state).elapsedMs,
    1000,
    'External execution can precede local application',
  );
});

test('agreement between both servers cannot hide a changed original request or owner', () => {
  const changedTask = copy(task),
    changedState = copy(state);
  changedTask.request.reference = changedState.request.reference = changedState.result.request.reference = 'REQ-999999';
  assert.throws(
    () => verifyCreatedOperation(expected, changedTask, 200, changedState, true),
    (error) => error.code === 'SAVED_REQUEST_CHANGED',
  );
  assert.throws(() => verifyCreatedOperation(expected, { ...task, ownerId: 'other' }, 200, state, true));
  assert.throws(() => verifyCreatedOperation(expected, { ...task, title: 'Other title' }, 200, state, true));
});

test('duplicates, wrong result identity, clock data and false completion fail qualification', () => {
  for (const mutate of [
    (x) => {
      x.executions = 2;
    },
    (x) => {
      x.executions = 0;
    },
    (x) => {
      x.result.version = 1;
    },
    (x) => {
      x.result.operationId = 'other';
    },
    (x) => {
      x.result.request.quantity = 26;
    },
    (x) => {
      x.result.status = 'REJECTED';
    },
    (x) => {
      x.result.completedAt = '2026-11-12T23:59:59Z';
    },
    (x) => {
      x.result.completedAt = '2026-11-13T03:00:01+03:00';
    },
  ]) {
    const invalid = copy(state);
    mutate(invalid);
    assert.throws(() => verifyCreatedOperation(expected, task, 200, invalid, true));
  }
  assert.throws(() => verifyCreatedOperation(expected, task, 404, { code: 'OPERATION_NOT_FOUND' }));
  assert.throws(() => verifyCreatedOperation(expected, task, 503, {}));
  assert.throws(() =>
    verifyCreatedOperation(
      expected,
      { ...task, result: { status: 'SUCCEEDED', completedAt: '2026-11-13T00:00:02Z' } },
      200,
      state,
      true,
    ),
  );
});

test('history links the same task, operation, author and one terminal result', () => {
  const common = { taskId: expected.taskId, operationId: 'operation', occurredAt: '2026-11-13T00:00:01Z' };
  const terminal = { ...common, type: 'RESULT_APPLIED', resultVersion: 2, actor: 'SYSTEM' };
  const creation = { ...common, type: 'CREATED', actor: 'USER', actorUserId: expected.ownerId };
  const history = { items: [terminal, creation], totalPages: 1 };
  verifyTaskHistory(expected, 'operation', history);
  for (const items of [
    [creation],
    [terminal, terminal, creation],
    [terminal, { ...creation, actorUserId: 'other' }],
    [{ ...terminal, taskId: 'other' }, creation],
  ]) {
    assert.throws(() => verifyTaskHistory(expected, 'operation', { items, totalPages: 1 }));
  }
});

test('final snapshot requires every accepted operation, history and cursor, including warmup records', () => {
  const digests = { ids: 'ids', requests: 'requests', results: 'results' };
  const snapshot = {
    app: {
      ...digests,
      records: 2,
      pending: 0,
      badLocalState: 0,
      queued: 0,
      openIssues: 0,
      badCreationHistory: 0,
      badTerminalHistory: 0,
      badRenameHistory: 0,
      lastCursor: 4,
    },
    emulator: { ...digests, accepted: 2, executed: 2, duplicateExecutions: 0, unpublished: 0, lastCursor: 4 },
  };
  verifyFinishedSnapshot(snapshot, 2);
  assert.throws(() => verifyFinishedSnapshot(snapshot, 3));
  for (const mutate of [
    (x) => {
      x.app.pending = 1;
    },
    (x) => {
      x.app.badLocalState = 1;
    },
    (x) => {
      x.app.queued = 1;
    },
    (x) => {
      x.app.openIssues = 1;
    },
    (x) => {
      x.app.badCreationHistory = 1;
    },
    (x) => {
      delete x.app.badTerminalHistory;
    },
    (x) => {
      x.app.badRenameHistory = 1;
    },
    (x) => {
      delete x.app.badRenameHistory;
    },
    (x) => {
      x.emulator.executed = 1;
    },
    (x) => {
      x.emulator.duplicateExecutions = 1;
    },
    (x) => {
      x.emulator.unpublished = 1;
    },
    (x) => {
      x.emulator.lastCursor = 5;
    },
    (x) => {
      x.emulator.requests = 'different';
    },
    (x) => {
      x.emulator.results = 'different';
    },
    (x) => {
      delete x.app.ids;
    },
  ]) {
    const invalid = copy(snapshot);
    mutate(invalid);
    assert.throws(() => verifyFinishedSnapshot(invalid, 2));
  }
});
