import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSteadyPhase } from './steady-assessment.mjs';

const phase = { plannedSeconds: 300, startedAt: '2026-11-15T00:00:00Z', targetCreatesPerSecond: 100 };
const samples = (pending, age) =>
  Array.from({ length: 60 }, (_, index) => ({
    at: new Date(Date.parse(phase.startedAt) + index * 5000).toISOString(),
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
      (i) => i / 20,
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
