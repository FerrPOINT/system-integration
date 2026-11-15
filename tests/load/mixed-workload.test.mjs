import test from 'node:test';
import assert from 'node:assert/strict';
import { mixedWorkload } from './mixed-workload.mjs';
import { ApiFailure } from '../support/http.mjs';

function fixture(change = () => {}) {
  const calls = [];
  const accounts = ['one', 'two'].map((owner) => ({ tasks: [owner + '-0', owner + '-1'] }));
  const clients = accounts.map((account, index) => {
    const revisions = new Map(account.tasks.map((id) => [id, 1]));
    const userId = index === 0 ? 'owner-one' : 'owner-two';
    const session = {
      async command(method, path, input) {
        calls.push({ owner: userId, method, path, input });
        const replacement = change(method, path, input);
        if (replacement !== undefined) return replacement;
        if (method === 'POST') return { taskId: 'created-' + input.request.reference };
        const task = path.split('/').at(-1);
        assert.ok(revisions.has(task), 'A rename must not use the other owner target');
        assert.equal(input.expectedTitleRevision, revisions.get(task));
        revisions.set(task, revisions.get(task) + 1);
        return { title: input.title, titleRevision: revisions.get(task) };
      },
      async get(path) {
        calls.push({ owner: userId, method: 'GET', path });
        if (path.includes('?'))
          return {
            items: Array.from({ length: 20 }, () => ({ ownerId: userId, businessStatus: 'SUCCEEDED' })),
            totalItems: 2500,
            totalPages: 125,
          };
        return { taskId: path.split('/').at(-1), ownerId: userId, titleRevision: 1 };
      },
    };
    return { index, session, userId, task: { taskId: account.tasks[0] } };
  });
  return { clients, accounts, calls };
}

test('fixed commands keep owners and revisions across phases; only the chosen phase reads', async () => {
  const f = fixture(),
    work = mixedWorkload(f.clients, f.accounts, [false, true, false]);
  await work.perform(0, 0);
  await work.perform(1, 1);
  await work.perform(4, 2);
  const patches = f.calls.filter((call) => call.method === 'PATCH');
  assert.deepEqual(
    patches.map((call) => [call.owner, call.path, call.input.expectedTitleRevision]),
    [
      ['owner-one', '/api/tasks/one-0', 1],
      ['owner-two', '/api/tasks/two-0', 1],
      ['owner-one', '/api/tasks/one-0', 2],
    ],
  );
  assert.equal(f.calls.filter((call) => call.method === 'GET').length, 2);
  assert.equal(work.created.length, 3);
  assert.deepEqual(
    work.created.map((task) => task.ownerId),
    ['owner-one', 'owner-two', 'owner-one'],
  );
  assert.equal(work.metrics[1].list.successes, 1);
  assert.equal(work.metrics[1].card.successes, 1);
  assert.equal(work.targets[0][0].revision, 3);
});

test('an unfinished rename cannot overlap; another owner still proceeds', async () => {
  let release;
  const f = fixture((method, path, input) => {
    if (method === 'PATCH' && path.endsWith('one-0'))
      return new Promise((resolve) => {
        release = () => resolve({ title: input.title, titleRevision: input.expectedTitleRevision + 1 });
      });
  });
  const work = mixedWorkload(f.clients, f.accounts, [false]);
  const pending = work.perform(0, 0);
  await assert.rejects(work.perform(4, 0), /unfinished rename/);
  await work.perform(1, 0);
  release();
  await pending;
  assert.equal(work.metrics[0].rename.successes, 2);
  assert.equal(work.targets[0][0].busy, false);
});

test('a bad rename response fails the metric and does not advance cached revision', async () => {
  const f = fixture((method) => (method === 'PATCH' ? { title: 'wrong', titleRevision: 99 } : undefined));
  const work = mixedWorkload(f.clients, f.accounts, [false]);
  await work.perform(0, 0);
  assert.deepEqual(work.metrics[0].rename.errors, { '200:INVALID_RENAME_RESULT': 1 });
  assert.equal(work.metrics[0].rename.successes, 0);
  assert.equal(work.metrics[0].create.successes, 1);
  assert.equal(work.targets[0][0].revision, 1);
});

test('a failed create is counted while the independent rename still settles', async () => {
  const f = fixture((method) => {
    if (method === 'POST') throw new ApiFailure(503, 'SERVICE_UNAVAILABLE');
  });
  const work = mixedWorkload(f.clients, f.accounts, [false]);
  await work.perform(0, 0);
  assert.deepEqual(work.metrics[0].create.errors, { '503:SERVICE_UNAVAILABLE': 1 });
  assert.equal(work.metrics[0].rename.successes, 1);
  assert.equal(work.created.length, 0);
  assert.equal(work.targets[0][0].busy, false);
});
