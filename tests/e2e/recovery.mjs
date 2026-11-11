import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ApiSession, ApiFailure, localOrigin } from '../support/http.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19580');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19581');
assert.equal(new URL(origin).port, '19580'); assert.equal(new URL(external).port, '19581');
const compose = ['compose', '--profile', 'app'];
const sqlQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
const databases = {
  app: 'PGPASSWORD="$SI_DB_PASSWORD" psql -h 127.0.0.1 -U si_app -d si_app -X -Atq -v ON_ERROR_STOP=1',
  emulator: 'PGPASSWORD="$SI_EMULATOR_DB_PASSWORD" psql -h 127.0.0.1 -U si_emulator -d si_emulator -X -Atq -v ON_ERROR_STOP=1',
};
const holders = new Set();
const receipt = { testSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), runtime: [], stages: [], passed: false };

function docker(args, options = {}) { return execFileSync('docker', args, { cwd: root, encoding: 'utf8', ...options }); }
function composeRun(args) { return docker([...compose, ...args]); }
function query(database, sql) {
  return docker([...compose, 'exec', '-T', 'postgres', 'sh', '-c', databases[database]], { input: "SET statement_timeout = '20s';\n" + sql + '\n' }).trim();
}
function queryJson(database, sql) { return JSON.parse(query(database, sql)); }
async function waitFor(label, condition, milliseconds = 60_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = await condition();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + label);
}
async function login() {
  if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
  const session = new ApiSession(origin); await session.login('initiator.one', process.env.SI_DEMO_PASSWORD); return session;
}
async function fault(reference, mode) {
  const response = await fetch(external + '/test/faults/' + reference, { method: mode ? 'PUT' : 'DELETE',
    signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json' }, body: mode ? JSON.stringify({ mode }) : undefined });
  assert.equal(response.status, 204);
}
async function inspect(operation) {
  const response = await fetch(external + '/operations/' + operation, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200); return response.json();
}
async function hold(database, acquisition) {
  const child = spawn('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c', databases[database]],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`SQL checkpoint exited ${code}: ${errors}`))); });
  // Observe rejection immediately even when a later cleanup awaits the same promise.
  done.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('CHECKPOINT_READY')) resolve(); });
    child.once('error', reject); child.once('exit', () => reject(new Error('SQL checkpoint did not become ready: ' + errors)));
  });
  const holder = { release: async () => {
    if (child.exitCode === null) child.stdin.end('ROLLBACK;\n\\q\n');
    await done; holders.delete(holder);
  } };
  holders.add(holder);
  child.stdin.write("BEGIN;\nSET LOCAL statement_timeout = '20s';\n" + acquisition + '\n\\echo CHECKPOINT_READY\n');
  return { ready, release: holder.release };
}
function mark(name, evidence) { receipt.stages.push({ name, at: new Date().toISOString(), ...evidence }); console.log(name); }

for (const service of ['backend', 'emulator']) {
  const id = composeRun(['ps', '-q', service]).trim(); assert.ok(id, service + ' must be running');
  const [container] = JSON.parse(docker(['inspect', id]));
  receipt.runtime.push({ service, image: container.Image, sourceCommit: container.Config.Labels['org.opencontainers.image.revision'] });
  const env = Object.fromEntries(container.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  assert.equal(service === 'backend' ? env.SI_DB_URL : env.SI_EMULATOR_DB_URL,
    service === 'backend' ? 'jdbc:postgresql://postgres:5432/si_app' : 'jdbc:postgresql://postgres:5432/si_emulator');
}

let api = await login();
const probes = [];
async function create(reference, mode) {
  await fault(reference); if (mode) await fault(reference, mode);
  const title = 'Recovery ' + randomUUID();
  const created = await api.command('POST', '/api/tasks', { title, request: { reference, quantity: 25 } });
  const task = await api.get('/api/tasks/' + created.taskId); probes.push(task);
  return task;
}
async function completed(task) {
  return waitFor('business result', async () => {
    const current = await api.get('/api/tasks/' + task.taskId); return current.businessStatus === 'SUCCEEDED' && current;
  });
}
try {
  const reference = 'REQ-830001';
  await fault(reference); await fault(reference, 'DROP_RESPONSE_AFTER_EXECUTION');
  const title = 'Recovery ' + randomUUID();
  const claimLatch = await hold('app', `DO $$ DECLARE target uuid; BEGIN LOOP
    SELECT t.id INTO target FROM tasks t JOIN delivery_queue q ON q.operation_id = t.operation_id
      WHERE t.request_reference = ${sqlQuote(reference)} AND t.title = ${sqlQuote(title)} AND q.claim_id IS NOT NULL LIMIT 1;
    IF target IS NOT NULL THEN PERFORM 1 FROM tasks WHERE id = target FOR UPDATE; EXIT; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP; END $$;`);
  const accepted = await api.command('POST', '/api/tasks', { title, request: { reference, quantity: 25 } });
  const task = await api.get('/api/tasks/' + accepted.taskId); probes.push(task);
  await claimLatch.ready;
  await waitFor('external commit', async () => {
    const response = await fetch(external + '/operations/' + task.operationId, { signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return false;
    assert.equal(response.status, 200); const state = await response.json(); return state.executions === 1 && state;
  });
  composeRun(['kill', '-s', 'SIGKILL', 'backend']);
  const interrupted = queryJson('app', `SELECT json_build_object('attempts',attempts,'claimId',claim_id) FROM delivery_queue WHERE operation_id = ${sqlQuote(task.operationId)};`);
  assert.equal(interrupted.attempts, 1); assert.ok(interrupted.claimId);
  await claimLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']); api = await login();
  await waitFor('recovered GET', async () => (await api.get('/api/tasks/' + task.taskId)).deliveryStatus === 'ACKNOWLEDGED');
  assert.equal((await inspect(task.operationId)).executions, 1);
  assert.equal(query('app', `SELECT outcome FROM delivery_attempts WHERE id = ${sqlQuote(interrupted.claimId)};`), 'INTERRUPTED');
  await fault(reference); await completed(task);
  mark('API recovers an interrupted durable claim through GET without reexecution', { taskId: task.taskId, operationId: task.operationId });

  const applying = await create('REQ-830002', 'DROP_RESPONSE_AFTER_EXECUTION');
  await waitFor('confirmed held result', async () => (await api.get('/api/tasks/' + applying.taskId)).deliveryStatus === 'ACKNOWLEDGED');
  const beforeCursor = Number(query('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1;'));
  const cursorLatch = await hold('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1 FOR UPDATE;'); await cursorLatch.ready;
  await fault('REQ-830002');
  await waitFor('consumer waiting before applying cursor', () => query('app', "SELECT count(*) FROM pg_stat_activity WHERE usename = 'si_app' AND wait_event_type = 'Lock' AND query LIKE 'SELECT last_cursor FROM incoming_position%';") !== '0');
  composeRun(['kill', '-s', 'SIGKILL', 'backend']);
  assert.equal(Number(query('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1;')), beforeCursor);
  assert.equal(query('app', `SELECT business_status FROM tasks WHERE id = ${sqlQuote(applying.taskId)};`), 'PENDING');
  await cursorLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']); api = await login(); await completed(applying);
  assert.equal(query('app', `SELECT count(*) FROM task_history WHERE task_id = ${sqlQuote(applying.taskId)} AND event_type = 'RESULT_APPLIED';`), '2');
  mark('API replays the uncommitted feed page once after restart', { taskId: applying.taskId, previousCursor: beforeCursor });

  const disabledWorker = "services:\n  emulator:\n    environment:\n      SI_EMULATOR_WORKER_ENABLED: 'false'\n";
  docker(['compose', '-f', 'compose.yml', '-f', '-', '--profile', 'app', 'up', '-d', '--no-build', '--no-deps', '--wait', 'emulator'], { input: disabledWorker });
  const pending = await create('REQ-830003');
  const acceptedState = await waitFor('external acceptance without execution', async () => {
    const response = await fetch(external + '/operations/' + pending.operationId, { signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return false;
    assert.equal(response.status, 200); const state = await response.json(); assert.equal(state.executions, 0); assert.equal(state.result, null); return state;
  });
  composeRun(['kill', '-s', 'SIGKILL', 'emulator']);
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'emulator']); await completed(pending);
  const resumedState = await inspect(pending.operationId);
  assert.equal(resumedState.executions, 1); assert.equal(resumedState.acceptedAt, acceptedState.acceptedAt);
  mark('Emulator executes a durably accepted operation after restart', { taskId: pending.taskId, operationId: pending.operationId });

  const publishLatch = await hold('emulator', 'SELECT last_cursor FROM feed_position WHERE id = 1 FOR UPDATE;'); await publishLatch.ready;
  // Normal execution must continue while the independent publisher waits on the counter.
  const unpublished = await create('REQ-830004');
  const executed = await waitFor('execution committed before publication', async () => {
    const response = await fetch(external + '/operations/' + unpublished.operationId, { signal: AbortSignal.timeout(5000) });
    if (response.status === 404) return false;
    assert.equal(response.status, 200); const state = await response.json(); return state.executions === 1 && state;
  });
  assert.equal(query('emulator', `SELECT count(*) FROM result_events WHERE operation_id = ${sqlQuote(unpublished.operationId)} AND cursor IS NULL;`), '2');
  composeRun(['kill', '-s', 'SIGKILL', 'emulator']); await publishLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'emulator']); await completed(unpublished);
  assert.deepEqual(await inspect(unpublished.operationId), executed);
  mark('Emulator publishes committed events after restart without a second execution', { taskId: unpublished.taskId, operationId: unpublished.operationId });

  const states = await Promise.all(probes.map(task => inspect(task.operationId)));
  const cursors = queryJson('app', 'SELECT json_build_object(\'cursor\',last_cursor) FROM incoming_position WHERE id = 1;');
  composeRun(['restart', 'postgres']); composeRun(['up', '-d', '--no-build', '--wait', 'postgres']);
  await waitFor('API database reconnect', async () => {
    try { return (await api.get('/api/tasks/' + task.taskId)).businessStatus === 'SUCCEEDED'; }
    catch (error) { if (error instanceof TypeError || (error instanceof ApiFailure && error.status >= 500)) return false; throw error; }
  });
  assert.deepEqual(await Promise.all(probes.map(task => inspect(task.operationId))), states);
  assert.deepEqual(queryJson('app', 'SELECT json_build_object(\'cursor\',last_cursor) FROM incoming_position WHERE id = 1;'), cursors);
  // Replayed delivery after both process and database restarts must still return the same operation.
  const original = states[0];
  const replays = await Promise.all([1, 2].map(() => fetch(external + '/operations/' + original.operationId, {
    method: 'PUT', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(original.request),
  })));
  for (const response of replays) assert.equal(response.status, 200);
  assert.deepEqual(await inspect(original.operationId), original);
  mark('PostgreSQL restart preserves results and feed position', { operations: states.map(state => ({ operationId: state.operationId, executions: state.executions, completedAt: state.result.completedAt })) });
  receipt.passed = true;
} catch (error) {
  receipt.error = { name: error.name, message: error.message };
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) {
    try { await holder.release(); } catch (error) { cleanupErrors.push(error); }
  }
  try { composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend', 'emulator']); }
  catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) { receipt.passed = false; receipt.cleanupErrors = cleanupErrors.map(error => error.message); }
  receipt.finishedAt = new Date().toISOString();
  await mkdir(new URL('../results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../results/recovery.json', import.meta.url), JSON.stringify(receipt, null, 2));
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Recovery cleanup requires attention');
}
