import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSteadyPhase } from './steady-assessment.mjs';

test('dense observations distinguish a bounded periodic queue from five-second sampling alias', () => {
  const queueAt = (ms) => 20 + Math.floor(((ms * 1.001) % 250) / 10);
  const point = (ms) => ({
    at: new Date(Date.parse(phase.startedAt) + ms).toISOString(),
    app: { pending: queueAt(ms), oldestPendingSeconds: 0.5 },
  });
  const sparse = Array.from({ length: 60 }, (_, i) => point(i * 5000));
  const average = (items) => items.reduce((sum, s) => sum + s.app.pending, 0) / items.length;
  assert.ok(average(sparse.slice(-12)) - average(sparse.slice(0, 12)) > 2);
  assert.equal(assessSteadyPhase(phase, sparse).reason, 'insufficient-window-observations');
  const dense = [];
  for (let at = 0, i = 0; at < 300000; at += 41 + (++i % 19)) dense.push(point(at));
  assert.equal(assessSteadyPhase(phase, dense).passed, true);
});

test('a long blind gap cannot qualify even with enough total samples', () => {
  const dense = samples(
    () => 1,
    () => 0.5,
  );
  assert.equal(
    assessSteadyPhase(
      phase,
      dense.filter((_, i) => i < 2000 || i >= 2200),
    ).reason,
    'observation-gap',
  );
});

const phase = { plannedSeconds: 300, startedAt: '2026-11-15T00:00:00Z', targetCreatesPerSecond: 100 };
const samples = (pending, age) =>
  Array.from({ length: 6000 }, (_, index) => ({
    at: new Date(Date.parse(phase.startedAt) + index * 50).toISOString(),
    app: { pending: pending(index), oldestPendingSeconds: age(index) },
  }));
test('bounded periodic queues qualify without requiring every sample to be empty', () => {
  assert.equal(
    assessSteadyPhase(
      phase,
      samples(
        (i) => i % 3,
        (i) => i % 4,
      ),
    ).passed,
    true,
  );
});
test('growing count, growing age, and an old tail each reject sustainability', () => {
  for (const data of [
    samples(
      (i) => i,
      () => 0.5,
    ),
    samples(
      () => 1,
      (i) => i / 2000,
    ),
    samples(
      () => 1,
      () => 5.1,
    ),
  ])
    assert.equal(assessSteadyPhase(phase, data).passed, false);
});
test('short or missing observation windows cannot qualify and malformed values fail explicitly', () => {
  assert.equal(assessSteadyPhase({ ...phase, plannedSeconds: 30 }, []).passed, false);
  assert.equal(assessSteadyPhase(phase, []).passed, false);
  assert.throws(() =>
    assessSteadyPhase(
      phase,
      samples(
        () => NaN,
        () => 0,
      ),
    ),
  );
});
