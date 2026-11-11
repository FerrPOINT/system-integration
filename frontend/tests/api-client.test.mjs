import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTask, getTaskReconciliation, listTasks, logIn, resolveExchangeIssue } from '../build/generated/openapi/client.ts';

test('login encodes the form and sends the CSRF header', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/login');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('content-type'), 'application/x-www-form-urlencoded');
    assert.equal(headers.get('x-csrf-token'), 'test-token');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), {
      username: 'demo.user',
      password: 'form & +',
    });
    return new Response(null, { status: 204 });
  });

  const response = await logIn(
    { username: 'demo.user', password: 'form & +' },
    { 'X-CSRF-TOKEN': 'test-token' },
  );

  assert.equal(response.status, 204);
  assert.equal(fetch.mock.callCount(), 1);
});

test('createTask sends both command headers and exposes a conflict response', async (t) => {
  const key = '40ad5299-2e09-4d7f-9a14-f02ca60f55ef';
  const body = { title: 'Проверка заявки', request: { reference: 'REQ-123456', quantity: 25 } };
  const problem = { title: 'Конфликт', status: 409, code: 'IDEMPOTENCY_CONFLICT' };

  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/tasks');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('idempotency-key'), key);
    assert.equal(headers.get('x-csrf-token'), 'test-token');
    assert.deepEqual(JSON.parse(init.body), body);
    return new Response(JSON.stringify(problem), {
      status: 409,
      headers: { 'content-type': 'application/problem+json' },
    });
  });

  const response = await createTask(body, {
    'X-CSRF-TOKEN': 'test-token',
    'Idempotency-Key': key,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.data, problem);
});

test('listTasks serializes filters and keeps page zero', async (t) => {
  const filters = { page: 0, businessStatus: 'SUCCEEDED', createdFrom: '2026-11-11T00:00:00Z' };
  const page = { items: [], page: 0, hasNext: false };

  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const request = new URL(url, 'http://localhost');
    assert.equal(request.pathname, '/api/tasks');
    assert.equal(init.method, 'GET');
    assert.deepEqual(Object.fromEntries(request.searchParams), { ...filters, page: '0' });
    return Response.json(page);
  });

  assert.deepEqual((await listTasks(filters)).data, page);
});

test('operator decision sends its snapshot and returns a stale-snapshot conflict', async (t) => {
  const issueId = '40ad5299-2e09-4d7f-9a14-f02ca60f55ef';
  const key = '1b8697dc-a20e-4d1c-8db0-68086c9150a6';
  const body = {
    expectedIssueRevision: 3,
    reconciliationId: 'edb34775-b3b8-4de7-816f-58312ed93c9b',
    action: 'ACKNOWLEDGE_DIFFERENCE',
    reason: 'Проверено по журналу',
  };
  const problem = { title: 'Снимок устарел', status: 409, code: 'SNAPSHOT_STALE' };

  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/exchange/issues/' + issueId + '/resolve');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('idempotency-key'), key);
    assert.equal(headers.get('x-csrf-token'), 'test-token');
    assert.deepEqual(JSON.parse(init.body), body);
    return Response.json(problem, { status: 409 });
  });

  const response = await resolveExchangeIssue(issueId, body, {
    'X-CSRF-TOKEN': 'test-token',
    'Idempotency-Key': key,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.data, problem);
});

test('saved reconciliation can be read again by its task and snapshot id', async (t) => {
  const taskId = '40ad5299-2e09-4d7f-9a14-f02ca60f55ef';
  const reconciliationId = 'edb34775-b3b8-4de7-816f-58312ed93c9b';
  const snapshot = {
    reconciliationId, taskId, operationId: taskId,
    checkedAt: '2026-11-12T00:00:00Z',
    checkedBy: '1b8697dc-a20e-4d1c-8db0-68086c9150a6',
    outcome: 'DIFFERENCE',
    local: {
      request: { reference: 'REQ-123456', quantity: 25 },
      deliveryStatus: 'ACKNOWLEDGED', businessStatus: 'PENDING',
    },
    externalAvailability: 'PRESENT',
    external: {
      operationId: taskId,
      request: { reference: 'REQ-123456', quantity: 25 },
      acceptedAt: '2026-11-12T00:00:00Z',
      executions: 1,
      result: {
        operationId: taskId,
        request: { reference: 'REQ-123456', quantity: 25 },
        version: 2,
        status: 'SUCCEEDED',
        completedAt: '2026-11-12T00:00:00Z',
      },
    },
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/tasks/' + taskId + '/reconciliations/' + reconciliationId);
    assert.equal(init.method, 'GET');
    return Response.json(snapshot);
  });

  const response = await getTaskReconciliation(taskId, reconciliationId);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, snapshot);
});
