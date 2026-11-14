import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, ProtocolError, data } from '../src/shared/api/http.ts';
import { getTask, logOut } from '../build/generated/openapi/client.ts';

for (const status of [401, 403, 409, 502, 503]) {
  for (const body of ['<html>proxy failure</html>', '', '{broken']) {
    test(`HTTP ${status} survives an unreadable problem body ${JSON.stringify(body)}`, async t => {
      t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }));
      const response = await getTask('fixture');
      assert.equal(response.status, status);
      await assert.rejects(data(Promise.resolve(response)), error => error instanceof ApiError && error.status === status && !error.message.includes(body || 'proxy'));
    });
  }
}

for (const body of ['', ' ', '<html>unexpected</html>', '{broken', 'null']) {
  test(`success requires a populated JSON body ${JSON.stringify(body)}`, async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 200 }));
    await assert.rejects(data(getTask('fixture')), error => error instanceof ProtocolError && error.status === 200);
  });
}

test('status, headers, signal and valid JSON survive the generated client boundary', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/tasks/fixture');
    assert.equal(options.signal, controller.signal);
    return Response.json({ taskId: 'fixture' }, { headers: { 'X-Receipt': 'receipt' } });
  });
  const response = await getTask('fixture', { signal: controller.signal });
  assert.equal(response.headers.get('x-receipt'), 'receipt');
  assert.deepEqual(await data(Promise.resolve(response)), { taskId: 'fixture' });
});

test('204 is a valid no-body response for logout', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.equal(await data(logOut({ 'X-CSRF-TOKEN': 'fixture' })), undefined);
});

for (const error of [new DOMException('Cancelled', 'AbortError'), new TypeError('Network failure')]) {
  test(`${error.name} retains its identity`, async t => {
    t.mock.method(globalThis, 'fetch', async () => { throw error; });
    await assert.rejects(data(getTask('fixture')), actual => actual === error);
  });
}

test('an interrupted error body retains HTTP status; an aborted body remains cancellation', async t => {
  const abort = new DOMException('Cancelled', 'AbortError');
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ status: 401, ok: false, headers: new Headers(), text: async () => { throw new TypeError('Connection lost'); } }));
  await assert.rejects(data(getTask('fixture')), error => error instanceof ApiError && error.status === 401);
  fetch.mock.mockImplementation(async () => ({ status: 200, ok: true, headers: new Headers(), text: async () => { throw abort; } }));
  await assert.rejects(data(getTask('fixture')), error => error === abort);
});
