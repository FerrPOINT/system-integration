import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { runSteadyArrivals } from './steady-workload.mjs';

test('arrival times are independent of response completion with explicit bounded missed arrivals', async () => {
  let active = 0, peak = 0;
  const result = await runSteadyArrivals({ rate: 100, durationMs: 100, maxInFlight: 2,
    perform: async () => { peak = Math.max(peak, ++active); await pause(150); active--; } });
  assert.equal(result.planned, 10);
  assert.equal(result.scheduled, 10);
  assert.equal(result.started, 2);
  assert.equal(result.missed, 8);
  assert.equal(result.notOffered, 0);
  assert.equal(result.peakInFlight, 2);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('a normal fixed-rate window completes every arrival and joins its response tail', async () => {
  let completed = 0;
  const result = await runSteadyArrivals({ rate: 100, durationMs: 100, maxInFlight: 10,
    perform: async () => { await pause(30); completed++; } });
  assert.equal(result.started, 10);
  assert.equal(result.missed, 0);
  assert.equal(completed, 10);
  assert.ok(result.peakInFlight > 1);
  assert.ok(result.elapsedIncludingTailMs >= 100);
});

test('a safety stop and an operation failure do not leave in-flight work behind', async () => {
  let completed = 0;
  const result = await runSteadyArrivals({ rate: 100, durationMs: 200, maxInFlight: 10,
    shouldStop: () => completed >= 3 ? 'probe-stop' : null,
    perform: async () => { completed++; } });
  assert.equal(result.stoppedFor, 'probe-stop');
  assert.equal(result.started, 3);
  assert.equal(result.notOffered, 17);
  let unfinished = 0;
  await assert.rejects(() => runSteadyArrivals({ rate: 100, durationMs: 200, maxInFlight: 10,
    perform: async index => {
      unfinished++;
      try { await pause(30); if (index === 0) throw new Error('probe-failure'); }
      finally { unfinished--; }
    } }), /probe-failure/);
  assert.equal(unfinished, 0);
});
