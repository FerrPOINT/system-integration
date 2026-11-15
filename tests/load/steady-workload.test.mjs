import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { runSteadyArrivals } from './steady-workload.mjs';

test('arrival times are independent of response completion with explicit bounded missed arrivals', async () => {
  let active = 0,
    peak = 0;
  const result = await runSteadyArrivals({
    phases: [{ rate: 100, durationMs: 100 }],
    maxInFlight: 2,
    perform: async () => {
      peak = Math.max(peak, ++active);
      await pause(150);
      active--;
    },
  });
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
  const result = await runSteadyArrivals({
    phases: [{ rate: 100, durationMs: 100 }],
    maxInFlight: 10,
    perform: async () => {
      await pause(30);
      completed++;
    },
  });
  assert.equal(result.started, 10);
  assert.equal(result.missed, 0);
  assert.equal(completed, 10);
  assert.ok(result.peakInFlight > 1);
  assert.ok(result.elapsedIncludingTailMs >= 100);
});

test('a safety stop and an operation failure do not leave in-flight work behind', async () => {
  let completed = 0;
  const result = await runSteadyArrivals({
    phases: [{ rate: 100, durationMs: 200 }],
    maxInFlight: 10,
    shouldStop: () => (completed >= 3 ? 'probe-stop' : null),
    perform: async () => {
      completed++;
    },
  });
  assert.equal(result.stoppedFor, 'probe-stop');
  assert.equal(result.started, 3);
  assert.equal(result.notOffered, 17);
  let unfinished = 0;
  await assert.rejects(
    () =>
      runSteadyArrivals({
        phases: [{ rate: 100, durationMs: 200 }],
        maxInFlight: 10,
        perform: async (index) => {
          unfinished++;
          try {
            await pause(30);
            if (index === 0) throw new Error('probe-failure');
          } finally {
            unfinished--;
          }
        },
      }),
    /probe-failure/,
  );
  assert.equal(unfinished, 0);
});

test('different phase rates retain ordered arrivals on one timeline', async () => {
  const offered = [];
  const result = await runSteadyArrivals({
    phases: [
      { rate: 20, durationMs: 100 },
      { rate: 50, durationMs: 100 },
    ],
    maxInFlight: 4,
    perform: async (index, phase) => {
      offered.push([index, phase]);
    },
  });
  assert.deepEqual(offered, [
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 1],
  ]);
  assert.equal(result.plannedDurationMs, 200);
  assert.equal(result.phases[0].finishedAt, result.phases[1].startedAt);
  assert.equal(result.notOffered, 0);
});

test('stopping a phase accounts for all later unoffered arrivals', async () => {
  let completed = 0;
  const result = await runSteadyArrivals({
    phases: [
      { rate: 100, durationMs: 100 },
      { rate: 100, durationMs: 100 },
    ],
    maxInFlight: 4,
    shouldStop: () => (completed >= 2 ? 'probe-stop' : null),
    perform: async () => {
      completed++;
    },
  });
  assert.equal(result.started, 2);
  assert.equal(result.notOffered, 18);
  assert.equal(result.phases[1].notOffered, 10);
  assert.equal(result.phases[1].stoppedFor, 'probe-stop');
});

test('callback failures are propagated even when their rejection value is falsy', async () => {
  for (const reason of [null, undefined, 0]) {
    await assert.rejects(
      () =>
        runSteadyArrivals({
          phases: [{ rate: 100, durationMs: 50 }],
          maxInFlight: 2,
          perform: async () => {
            throw reason;
          },
        }),
      (error) => error === reason,
    );
  }
});

test('a phase boundary neither drains pending responses nor resets global concurrency', async () => {
  const first = Promise.withResolvers();
  let firstFinished = false,
    crossed = false;
  const rescue = setTimeout(() => first.resolve(), 1000);
  try {
    const result = await runSteadyArrivals({
      phases: [
        { rate: 20, durationMs: 50 },
        { rate: 20, durationMs: 50 },
      ],
      maxInFlight: 2,
      perform: async (_index, phase) => {
        if (phase === 0) {
          await first.promise;
          firstFinished = true;
        } else {
          assert.equal(firstFinished, false, 'The next phase must start before the earlier response tail completes');
          crossed = true;
          first.resolve();
        }
      },
    });
    assert.equal(crossed, true);
    assert.equal(result.started, 2);
    assert.equal(result.phases[1].plannedStartOffsetMs, 50);
    assert.equal(firstFinished, true);
  } finally {
    first.resolve();
    clearTimeout(rescue);
  }
  const capped = await runSteadyArrivals({
    phases: [
      { rate: 100, durationMs: 100 },
      { rate: 100, durationMs: 100 },
    ],
    maxInFlight: 1,
    perform: () => pause(250),
  });
  assert.equal(capped.started, 1);
  assert.equal(capped.missed, 19);
  assert.equal(capped.phases[1].missed, 10);
  assert.equal(capped.peakInFlight, 1);
});
