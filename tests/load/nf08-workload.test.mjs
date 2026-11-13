import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { runNf08Workload, validateNf08Workload } from './nf08-workload.mjs';

function clients(badList = false) {
  let serial = 0;
  return Array.from({ length: 20 }, (_, index) => {
    let revision = 1, active = 0;
    const userId = 'owner-' + index % 2, taskId = 'task-' + index;
    const task = () => ({ taskId, ownerId: userId, titleRevision: revision });
    const perform = async action => {
      assert.equal(++active, 1, 'Each session must finish one action before starting its next action');
      try { await pause(1); return action(); } finally { active--; }
    };
    return { index, userId, task: task(), action: index % 4, counter: 0, session: {
      get(path) {
        return perform(() => path.includes('?')
          ? { totalItems: 2500, totalPages: 125, items: Array.from({ length: 20 }, () =>
            ({ businessStatus: 'SUCCEEDED', ownerId: badList ? 'foreign-owner' : userId })) }
          : task());
      },
      command(method, path, input) {
        return perform(() => {
          if (method === 'POST') return { taskId: 'created-' + serial++ };
          assert.equal(input.expectedTitleRevision, revision);
          return { titleRevision: ++revision };
        });
      },
    } };
  });
}

test('the same NF08 loop retains four operations, fairness, ownership and complete creation accounting', async () => {
  const result = await runNf08Workload(clients(), { warmupMs: 10, measureMs: 40 });
  const counts = result.measurements.map(stat => stat.latencies.length);
  assert.ok(counts.every(count => count > 0));
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 20);
  assert.ok(result.measurements.every(stat => stat.successes === stat.latencies.length && !Object.keys(stat.errors).length));
  assert.ok(result.allCreated.length >= result.created.length && result.created.length > 0);
  assert.equal(new Set(result.allCreated.map(item => item.taskId)).size, result.allCreated.length);
  assert.ok(result.allCreated.every(item => item.ownerId === 'owner-' + item.client % 2));
  assert.ok(result.generator.durationMs >= 50);
  assert.ok(!JSON.stringify(result).includes('session'));
});

test('failed HTTP semantics remain errors and latencies rather than successful fast responses', async () => {
  const result = await runNf08Workload(clients(true), { warmupMs: 0, measureMs: 40 });
  const list = result.measurements[0];
  assert.equal(list.successes, 0);
  assert.ok(list.errors['200:INVALID_LIST_PAGE'] > 0);
  assert.equal(list.errors['200:INVALID_LIST_PAGE'], list.latencies.length);
});

test('external workload reports reject missing timing, nonfinite latency and inconsistent successes', () => {
  const valid = {
    warmupSeconds: 30, measuredSeconds: 120, generator: { durationMs: 150001 },
    created: [], allCreated: [], warmupErrors: {},
    measurements: ['list', 'card', 'create', 'rename'].map(operation =>
      ({ operation, successes: 1, errors: {}, latencies: [1] })),
  };
  validateNf08Workload(valid);
  for (const mutate of [
    item => { delete item.generator; },
    item => { item.generator.durationMs = 1; },
    item => { item.measurements[0].latencies[0] = null; },
    item => { item.measurements[0].latencies[0] = NaN; },
    item => { item.measurements[0].successes = 0; },
    item => { item.measurements[0].errors.bad = -1; },
  ]) {
    const changed = structuredClone(valid); mutate(changed);
    assert.throws(() => validateNf08Workload(changed), /malformed/);
  }
});
