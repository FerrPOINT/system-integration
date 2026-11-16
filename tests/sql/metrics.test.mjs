import { execFileSync, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loadSnapshot } from '../load/metrics.mjs';
import { queueSql } from '../load/queue-observer.mjs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Diagnostic only: no load qualification, no application restart, no ordinary-DB mutations.
assert.equal(
  process.cwd(),
  fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''),
  'Run from the repository root',
);
const active = execFileSync(
  'docker',
  [
    'exec',
    'system-integration-load-postgres-1',
    'psql',
    '-XqAt',
    '-U',
    'si_admin',
    '-d',
    'postgres',
    '-c',
    "SELECT count(*) FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test')",
  ],
  { encoding: 'utf8' },
).trim();
assert.equal(active, '0', 'Test databases must have no active sessions');
const services = ['postgres'];
const resources = services.map((service) => {
  const [container] = JSON.parse(
    execFileSync('docker', ['inspect', 'system-integration-load-' + service + '-1'], { encoding: 'utf8' }),
  );
  assert.equal(container.Config.Labels['com.docker.compose.project'], 'system-integration-load');
  return { service, containerId: container.Id, startedAt: container.State.StartedAt };
});
const sessions = [];

test('queue snapshot counts both unfinished states and excludes both terminal neighbors', () => {
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'system-integration-load-postgres-1',
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'si_test',
      '-d',
      'si_test',
    ],
    {
      encoding: 'utf8',
      input: `
BEGIN;
CREATE TEMP TABLE tasks (LIKE public.tasks INCLUDING ALL) ON COMMIT DROP;
INSERT INTO tasks(id,owner_id,operation_id,title,request_reference,request_quantity,business_status,created_at)
VALUES
(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'pending-fixture','REQ-000001',25,'PENDING','2003-01-01T00:00:00Z'),
(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'running-fixture','REQ-000002',25,'RUNNING','2002-01-01T00:00:00Z'),
(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'succeeded-fixture','REQ-000003',25,'SUCCEEDED','2000-01-01T00:00:00Z'),
(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'rejected-fixture','REQ-000004',25,'REJECTED','2001-01-01T00:00:00Z');
${queueSql};
UPDATE tasks SET business_status='SUCCEEDED' WHERE title='running-fixture';
${queueSql};
UPDATE tasks SET business_status='REJECTED' WHERE title='pending-fixture';
${queueSql};
ROLLBACK;
`,
    },
  );
  const snapshots = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    snapshots.map((s) => s.app.pending),
    [2, 1, 0],
  );
  for (const [index, created] of ['2002-01-01T00:00:00Z', '2003-01-01T00:00:00Z'].entries()) {
    const sample = snapshots[index];
    const expected = (Date.parse(sample.at) - Date.parse(created)) / 1000;
    assert.ok(Number.isFinite(expected));
    // PostgreSQL retains microseconds; JavaScript Date truncates to milliseconds.
    assert.ok(Math.abs(sample.app.oldestPendingSeconds - expected) < 0.001001);
  }
  assert.equal(snapshots[2].app.oldestPendingSeconds, 0);
});

function session(label) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      'system-integration-load-postgres-1',
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'si_test',
      '-d',
      'si_test',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  sessions.push(child);
  let buffer = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SQL diagnostic did not reach its checkpoint')), 5000);
    child.stdout.on('data', (data) => {
      buffer += data;
      const match = buffer.match(new RegExp(label + ':(\\d+)'));
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error('SQL diagnostic exited with ' + code));
      }
    });
  });
  return { child, ready };
}
test('SQL observer identifies a known blocker without changing data', { timeout: 60000 }, async () => {
  let holder, waiter;
  try {
    holder = session('HOLDER');
    holder.child.stdin.write(
      "BEGIN; SELECT last_cursor FROM incoming_position WHERE id=1 FOR UPDATE; SELECT 'HOLDER:'||pg_backend_pid();\n",
    );
    const holdingPid = await holder.ready;
    waiter = session('WAITER');
    waiter.child.stdin.end(
      "BEGIN; SELECT 'WAITER:'||pg_backend_pid(); SELECT last_cursor FROM incoming_position WHERE id=1 FOR UPDATE; ROLLBACK;\n",
    );
    const waitingPid = await waiter.ready;
    let sample, blocked;
    for (let attempt = 0; attempt < 3; attempt++) {
      sample = await loadSnapshot(resources);
      blocked = sample.app.blocked.find((row) => row.pid === waitingPid);
      if (blocked) break;
    }
    assert.ok(blocked, 'The observer must see the known waiting test transaction');
    assert.ok(blocked.blockers.includes(holdingPid));
    assert.equal(blocked.wait_event_type, 'Lock');
    assert.match(blocked.query, /SELECT last_cursor FROM incoming_position.*FOR UPDATE/);
    assert.ok(
      sample.app.activeQueries.some((row) => row.query.includes('FOR UPDATE') && row.wait_event_type === 'Lock'),
    );
    assert.ok(sample.app.activeQueries.every((row) => row.sessions > 0 && row.oldest_query_seconds >= 0));
    assert.ok(blocked.transaction_age_seconds >= 0);
    assert.ok(sample.app.transactions.active >= 1);
    assert.ok(sample.runnerProcess.cpuMicros.user >= 0);
    assert.ok(sample.runnerProcess.rssBytes > 0);
    assert.ok(sample.host.totalMemoryBytes > 0);
    await writeFile(
      'tests/results/metrics-lock-observation.json',
      JSON.stringify(
        {
          diagnostic: 'known cursor lock in si_test; not evidence of the production bottleneck',
          holdingPid,
          waitingPid,
          sample,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ observer: 'PASS', waitType: blocked.wait_event_type, runnerHost: sample.runnerProcess.host }),
    );
  } finally {
    if (holder && !holder.child.stdin.destroyed) holder.child.stdin.end('ROLLBACK;\n');
    await Promise.all(
      sessions.map((child) =>
        child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve)),
      ),
    );
  }
});
