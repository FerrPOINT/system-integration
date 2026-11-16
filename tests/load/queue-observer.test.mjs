import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { observeQueue } from './queue-observer.mjs';

class TestClient extends EventEmitter {
  connects = 0;
  ends = 0;
  calls = 0;
  inFlight = 0;
  peakInFlight = 0;
  failAt = Infinity;
  async connect() {
    this.connects++;
  }
  async query() {
    this.calls++;
    this.peakInFlight = Math.max(this.peakInFlight, ++this.inFlight);
    try {
      await pause(7);
      if (this.calls === this.failAt) throw Object.assign(new Error('not recorded'), { code: 'TEST_QUERY_FAILED' });
      const sample = { at: new Date().toISOString(), app: { pending: 3, oldestPendingSeconds: 0.4 } };
      this.emit('sample', this.calls);
      return { rows: [{ sample }] };
    } finally {
      this.inFlight--;
    }
  }
  async end() {
    this.ends++;
  }
}

test('queue observer has one connection, no overlapping query and no work after stop', async () => {
  const client = new TestClient();
  const observer = await observeQueue(client);
  while (client.calls < 4) await once(client, 'sample');
  await Promise.all([observer.stop(), observer.stop()]);
  const count = client.calls;
  await pause(120);
  assert.equal(client.calls, count);
  assert.equal(client.connects, 1);
  assert.equal(client.ends, 1);
  assert.equal(client.peakInFlight, 1);
  assert.ok(observer.samples.length >= 4);
  assert.ok(observer.samples.every((s) => s.app.pending === 3 && s.app.oldestPendingSeconds === 0.4));
  assert.deepEqual(observer.errors, []);
});

test('query and idle connection errors stay explicit and never reconnect', async () => {
  for (const idle of [false, true]) {
    const client = new TestClient();
    client.failAt = idle ? Infinity : 2;
    const observer = await observeQueue(client);
    if (idle) client.emit('error', Object.assign(new Error('not recorded'), { code: 'TEST_IDLE_FAILED' }));
    const deadline = Date.now() + 2000;
    while (!observer.errors.length && Date.now() < deadline) await pause(10);
    await observer.stop();
    assert.deepEqual(observer.errors, [idle ? 'TEST_IDLE_FAILED' : 'TEST_QUERY_FAILED']);
    assert.equal(client.connects, 1);
    assert.equal(client.ends, 1);
  }
});

test('startup query failure closes its connection and does not start a background loop', async () => {
  const client = new TestClient();
  client.failAt = 1;
  await assert.rejects(observeQueue(client), { code: 'TEST_QUERY_FAILED' });
  await pause(100);
  assert.equal(client.calls, 1);
  assert.equal(client.ends, 1);
});

test('malformed queue data is an error rather than an empty successful snapshot', async () => {
  const client = new TestClient();
  client.query = async () => ({
    rows: [{ sample: { at: new Date().toISOString(), app: { pending: NaN, oldestPendingSeconds: 0 } } }],
  });
  await assert.rejects(observeQueue(client), /Invalid queue observation/);
  assert.equal(client.ends, 1);
});
