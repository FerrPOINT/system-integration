import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from '../load/environment.mjs';
import { loadIntegrity, drainLoad } from '../load/metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from '../load/integrity.mjs';

const git = (...args) => execFileSync('git', args, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim();
const testSourceCommit = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain'), '', 'Commit the diagnostic runner first');
const applicationCommit = process.env.SI_TAIL_APP_COMMIT || testSourceCommit;
assert.match(applicationCommit, /^[a-f0-9]{40}$/);
assert.equal(git('rev-parse', applicationCommit + '^{commit}'), applicationCommit);
const resources = qualifiedLoadEnvironment(applicationCommit);
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
assert.ok(process.env.SI_DEMO_PASSWORD);
const report = {
  applicationCommit,
  testSourceCommit,
  resources,
  trials: [],
  dataCorrect: false,
  isolated: false,
  scope:
    'Private fault diagnostic: five delayed HTTP replies, one following normal operation each; not NF08 or normal-mode capacity',
};
const owner = new ApiSession(origin),
  operator = new ApiSession(origin),
  created = [],
  faulted = new Set();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(label, condition) {
  const deadline = performance.now() + 15000;
  do {
    const value = await condition();
    if (value) return value;
    await pause(10);
  } while (performance.now() < deadline);
  throw new Error(label);
}
async function externalState(id) {
  const response = await fetch(external + '/operations/' + id, { signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (response.status === 404 && value.code === 'OPERATION_NOT_FOUND') return null;
  assert.equal(response.status, 200);
  return value;
}
async function fault(reference, mode) {
  const response = await fetch(external + '/test/faults/' + reference, {
    method: mode ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: mode ? JSON.stringify({ mode }) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 204);
}
async function create(reference, title, ownerId) {
  const result = await owner.command('POST', '/api/tasks', { title, request: { reference, quantity: 25 } });
  const task = await owner.get('/api/tasks/' + result.taskId);
  created.push({ taskId: result.taskId, client: 0, ownerId, reference, title });
  return task;
}
async function quiescent() {
  await until('delivery did not finish', async () => {
    const view = await operator.get('/actuator/exchange');
    return view.feed.deliveryInFlight === 0 && view.deliveryQueue.operations === 0;
  });
}
try {
  const initial = await loadIntegrity(resources);
  assert.equal(initial.app.records, 0);
  assert.equal(initial.emulator.accepted, 0);
  const identity = await owner.login('initiator.one', process.env.SI_DEMO_PASSWORD);
  await operator.login('operator', process.env.SI_DEMO_PASSWORD);
  for (let n = 0; n < 5; n++) {
    const task = await create('REQ-' + (860000 + n), 'Isolation warm ' + n, identity.userId);
    await until(
      'warm task did not complete',
      async () => (await owner.get('/api/tasks/' + task.taskId)).businessStatus === 'SUCCEEDED',
    );
  }
  await quiescent();
  for (let n = 0; n < 5; n++) {
    const reference = 'REQ-' + (860100 + n * 2),
      trialStarted = performance.now();
    faulted.add(reference);
    await fault(reference, 'DROP_RESPONSE_AFTER_EXECUTION');
    try {
      const slow = await create(reference, 'Isolation slow ' + n, identity.userId);
      await until('delayed operation not accepted', () => externalState(slow.operationId));
      const before = await operator.get('/actuator/exchange');
      assert.ok(before.feed.deliveryInFlight >= 1, 'The delayed HTTP response must actually be in flight');
      const fastStarted = performance.now();
      const fast = await create('REQ-' + (860101 + n * 2), 'Isolation fast ' + n, identity.userId);
      await until('following operation not accepted', () => externalState(fast.operationId));
      const acceptedAfterMs = performance.now() - fastStarted;
      report.trials.push({ acceptedAfterMs, delayedResponseWasInFlight: true });
      await until(
        'following result not applied',
        async () => (await owner.get('/api/tasks/' + fast.taskId)).businessStatus === 'SUCCEEDED',
      );
      await quiescent();
    } finally {
      await fault(reference);
      faulted.delete(reference);
      // The emulator's deliberate reply delay is 5 s. Keep trials independent;
      // this cooldown is outside the measured acceptance interval.
      await pause(Math.max(0, 5500 - (performance.now() - trialStarted)));
    }
  }
  report.drain = await drainLoad(resources);
  report.integrity = await loadIntegrity(resources);
  verifyFinishedSnapshot(report.integrity, 15);
  report.verified = await verifyCreatedTasks(created, [{ session: owner }], external, true);
  report.dataCorrect =
    report.drain.drained && report.verified.completed === 15 && !Object.keys(report.verified.errors).length;
  report.isolated = report.trials.length === 5 && report.trials.every((t) => t.acceptedAfterMs < 1000);
} catch (error) {
  report.error = error instanceof ApiFailure ? error.code : error.name;
  report.failureAt = error.stack
    ?.split('\n')
    .find((line) => line.includes('delivery-isolation.mjs:'))
    ?.trim();
} finally {
  for (const reference of faulted) {
    try {
      await fault(reference);
    } catch (error) {
      report.cleanupError = error.name;
    }
  }
}
report.resourcesAfter = qualifiedLoadEnvironment(applicationCommit);
report.sourceUnchanged = testSourceCommit === git('rev-parse', 'HEAD') && !git('status', '--porcelain');
report.passed =
  report.dataCorrect &&
  report.isolated &&
  report.sourceUnchanged &&
  !report.cleanupError &&
  JSON.stringify(resources) === JSON.stringify(report.resourcesAfter);
await writeFile(new URL('../results/delivery-isolation.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      dataCorrect: report.dataCorrect,
      isolated: report.isolated,
      trials: report.trials,
      error: report.error,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
