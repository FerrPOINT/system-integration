import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ApiSession, ApiFailure, localOrigin } from '../support/http.mjs';
import { loadEnvironment } from '../load/environment.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
const compose = [
  'compose',
  '-p',
  'system-integration-load',
  '-f',
  'compose.yml',
  '-f',
  'compose.public.yml',
  '-f',
  'compose.load.yml',
  '--profile',
  'app',
];
loadEnvironment();
const sqlQuote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const databases = {
  app: 'PGPASSWORD="$SI_TEST_DB_PASSWORD" psql -h 127.0.0.1 -U si_test -d si_test -X -Atq -v ON_ERROR_STOP=1',
  emulator:
    'PGPASSWORD="$SI_EMULATOR_TEST_DB_PASSWORD" psql -h 127.0.0.1 -U si_emulator_test -d si_emulator_test -X -Atq -v ON_ERROR_STOP=1',
};
const holders = new Set();
const receipt = {
  testSourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(),
  runtime: [],
  stages: [],
  passed: false,
};

function docker(args, options = {}) {
  return execFileSync('docker', args, { cwd: root, encoding: 'utf8', ...options });
}
function composeRun(args) {
  return docker([...compose, ...args]);
}
function query(database, sql) {
  return docker([...compose, 'exec', '-T', 'postgres', 'sh', '-c', databases[database]], {
    input: "SET statement_timeout = '20s';\n" + sql + '\n',
  }).trim();
}
function queryJson(database, sql) {
  return JSON.parse(query(database, sql));
}
async function waitFor(label, condition, milliseconds = 60_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = await condition();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + label);
}
async function login(username = 'initiator.one') {
  if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
  const session = new ApiSession(origin, { Connection: 'close' });
  await session.login(username, process.env.SI_DEMO_PASSWORD);
  return session;
}
async function fault(reference, mode) {
  const response = await fetch(external + '/test/faults/' + reference, {
    method: mode ? 'PUT' : 'DELETE',
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: mode ? JSON.stringify({ mode }) : undefined,
  });
  assert.equal(response.status, 204);
}
async function inspect(operation) {
  const response = await fetch(external + '/operations/' + operation, {
    headers: { Connection: 'close' },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function hold(database, acquisition) {
  const child = spawn('docker', [...compose, 'exec', '-T', 'postgres', 'sh', '-c', databases[database]], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '',
    errors = '';
  child.stderr.on('data', (chunk) => {
    errors = (errors + chunk).slice(-4000);
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`SQL checkpoint exited ${code}: ${errors}`)),
    );
  });
  // Observe rejection immediately even when a later cleanup awaits the same promise.
  done.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('CHECKPOINT_READY')) resolve();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('SQL checkpoint did not become ready: ' + errors)));
  });
  const holder = {
    release: async () => {
      if (child.exitCode === null) child.stdin.end('ROLLBACK;\n\\q\n');
      await done;
      holders.delete(holder);
    },
  };
  holders.add(holder);
  child.stdin.write("BEGIN;\nSET LOCAL statement_timeout = '20s';\n" + acquisition + '\n\\echo CHECKPOINT_READY\n');
  return { ready, release: holder.release };
}
function mark(name, evidence) {
  receipt.stages.push({ name, at: new Date().toISOString(), ...evidence });
  console.log(name);
}

for (const service of ['backend', 'emulator']) {
  const id = composeRun(['ps', '-q', service]).trim();
  assert.ok(id, service + ' must be running');
  const [container] = JSON.parse(docker(['inspect', id]));
  receipt.runtime.push({
    service,
    image: container.Image,
    sourceCommit: container.Config.Labels['org.opencontainers.image.revision'],
  });
  const env = Object.fromEntries(
    container.Config.Env.map((value) => {
      const i = value.indexOf('=');
      return [value.slice(0, i), value.slice(i + 1)];
    }),
  );
  assert.equal(
    service === 'backend' ? env.SI_DB_URL : env.SI_EMULATOR_DB_URL,
    service === 'backend'
      ? 'jdbc:postgresql://postgres:5432/si_test'
      : 'jdbc:postgresql://postgres:5432/si_emulator_test',
  );
}

let api = await login();
const probes = [];
async function create(reference, mode) {
  await fault(reference);
  if (mode) await fault(reference, mode);
  const title = 'Recovery ' + randomUUID();
  const created = await api.command('POST', '/api/tasks', { title, request: { reference, quantity: 25 } });
  const task = await api.get('/api/tasks/' + created.taskId);
  probes.push(task);
  return task;
}
async function completed(task, milliseconds = 60_000) {
  return waitFor(
    'business result',
    async () => {
      const current = await api.get('/api/tasks/' + task.taskId);
      return current.businessStatus === 'SUCCEEDED' && current;
    },
    milliseconds,
  );
}
try {
  const reference = 'REQ-830001';
  await fault(reference);
  await fault(reference, 'DROP_RESPONSE_AFTER_EXECUTION');
  const title = 'Recovery ' + randomUUID();
  const claimLatch = await hold(
    'app',
    `DO $$ DECLARE target uuid; BEGIN LOOP
    SELECT t.id INTO target FROM tasks t JOIN delivery_queue q ON q.operation_id = t.operation_id
      WHERE t.request_reference = ${sqlQuote(reference)} AND t.title = ${sqlQuote(title)} AND q.claim_id IS NOT NULL LIMIT 1;
    IF target IS NOT NULL THEN PERFORM 1 FROM tasks WHERE id = target FOR UPDATE; EXIT; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP; END $$;`,
  );
  const accepted = await api.command('POST', '/api/tasks', { title, request: { reference, quantity: 25 } });
  const task = await api.get('/api/tasks/' + accepted.taskId);
  probes.push(task);
  await claimLatch.ready;
  await waitFor('external commit', async () => {
    const response = await fetch(external + '/operations/' + task.operationId, {
      headers: { Connection: 'close' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return false;
    assert.equal(response.status, 200);
    const state = await response.json();
    return state.executions === 1 && state;
  });
  composeRun(['kill', '-s', 'SIGKILL', 'backend']);
  const interrupted = queryJson(
    'app',
    `SELECT json_build_object('attempts',attempts,'claimId',claim_id) FROM delivery_queue WHERE operation_id = ${sqlQuote(task.operationId)};`,
  );
  assert.equal(interrupted.attempts, 1);
  assert.ok(interrupted.claimId);
  await claimLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']);
  api = await login();
  await waitFor(
    'recovered GET',
    async () => (await api.get('/api/tasks/' + task.taskId)).deliveryStatus === 'ACKNOWLEDGED',
  );
  assert.equal((await inspect(task.operationId)).executions, 1);
  assert.equal(
    query('app', `SELECT outcome FROM delivery_attempts WHERE id = ${sqlQuote(interrupted.claimId)};`),
    'INTERRUPTED',
  );
  await fault(reference);
  await completed(task);
  mark('API recovers an interrupted durable claim through GET without reexecution', {
    taskId: task.taskId,
    operationId: task.operationId,
  });

  const applying = await create('REQ-830002', 'DROP_RESPONSE_AFTER_EXECUTION');
  await waitFor(
    'confirmed held result',
    async () => (await api.get('/api/tasks/' + applying.taskId)).deliveryStatus === 'ACKNOWLEDGED',
  );
  const beforeCursor = Number(query('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1;'));
  const cursorLatch = await hold('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1 FOR UPDATE;');
  await cursorLatch.ready;
  await fault('REQ-830002');
  await waitFor(
    'consumer waiting before applying cursor',
    () =>
      query(
        'app',
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user AND wait_event_type = 'Lock' AND query LIKE 'SELECT last_cursor FROM incoming_position%';",
      ) !== '0',
  );
  composeRun(['kill', '-s', 'SIGKILL', 'backend']);
  assert.equal(Number(query('app', 'SELECT last_cursor FROM incoming_position WHERE id = 1;')), beforeCursor);
  assert.equal(query('app', `SELECT business_status FROM tasks WHERE id = ${sqlQuote(applying.taskId)};`), 'PENDING');
  await cursorLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']);
  api = await login();
  await completed(applying);
  assert.equal(
    query(
      'app',
      `SELECT count(*) FROM task_history WHERE task_id = ${sqlQuote(applying.taskId)} AND event_type = 'RESULT_APPLIED';`,
    ),
    '2',
  );
  mark('API replays the uncommitted feed page once after restart', {
    taskId: applying.taskId,
    previousCursor: beforeCursor,
  });

  const disabledWorker = "services:\n  emulator:\n    environment:\n      SI_EMULATOR_WORKER_ENABLED: 'false'\n";
  docker([...compose, '-f', '-', 'up', '-d', '--no-build', '--no-deps', '--wait', 'emulator'], {
    input: disabledWorker,
  });
  loadEnvironment();
  const pending = await create('REQ-830003');
  const acceptedState = await waitFor('external acceptance without execution', async () => {
    const response = await fetch(external + '/operations/' + pending.operationId, {
      headers: { Connection: 'close' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return false;
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.executions, 0);
    assert.equal(state.result, null);
    return state;
  });
  composeRun(['kill', '-s', 'SIGKILL', 'emulator']);
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'emulator']);
  await completed(pending);
  const resumedState = await inspect(pending.operationId);
  assert.equal(resumedState.executions, 1);
  assert.equal(resumedState.acceptedAt, acceptedState.acceptedAt);
  mark('Emulator executes a durably accepted operation after restart', {
    taskId: pending.taskId,
    operationId: pending.operationId,
  });

  const publishLatch = await hold('emulator', 'SELECT last_cursor FROM feed_position WHERE id = 1 FOR UPDATE;');
  await publishLatch.ready;
  // Normal execution must continue while the independent publisher waits on the counter.
  const unpublished = await create('REQ-830004');
  const executed = await waitFor('execution committed before publication', async () => {
    const response = await fetch(external + '/operations/' + unpublished.operationId, {
      headers: { Connection: 'close' },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return false;
    assert.equal(response.status, 200);
    const state = await response.json();
    return state.executions === 1 && state;
  });
  assert.equal(
    query(
      'emulator',
      `SELECT count(*) FROM result_events WHERE operation_id = ${sqlQuote(unpublished.operationId)} AND cursor IS NULL;`,
    ),
    '2',
  );
  composeRun(['kill', '-s', 'SIGKILL', 'emulator']);
  await publishLatch.release();
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'emulator']);
  await completed(unpublished);
  assert.deepEqual(await inspect(unpublished.operationId), executed);
  mark('Emulator publishes committed events after restart without a second execution', {
    taskId: unpublished.taskId,
    operationId: unpublished.operationId,
  });

  const states = await Promise.all(probes.map((task) => inspect(task.operationId)));
  const cursors = queryJson(
    'app',
    "SELECT json_build_object('cursor',last_cursor) FROM incoming_position WHERE id = 1;",
  );
  composeRun(['restart', 'postgres']);
  composeRun(['up', '-d', '--no-build', '--wait', 'postgres']);
  await waitFor('API database reconnect', async () => {
    try {
      return (await api.get('/api/tasks/' + task.taskId)).businessStatus === 'SUCCEEDED';
    } catch (error) {
      if (error instanceof TypeError || (error instanceof ApiFailure && error.status >= 500)) return false;
      throw error;
    }
  });
  assert.deepEqual(await Promise.all(probes.map((task) => inspect(task.operationId))), states);
  assert.deepEqual(
    queryJson('app', "SELECT json_build_object('cursor',last_cursor) FROM incoming_position WHERE id = 1;"),
    cursors,
  );
  // Replayed delivery after both process and database restarts must still return the same operation.
  const original = states[0];
  const replays = await Promise.all(
    [1, 2].map(() =>
      fetch(external + '/operations/' + original.operationId, {
        method: 'PUT',
        signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(original.request),
      }),
    ),
  );
  for (const response of replays) assert.equal(response.status, 200);
  assert.deepEqual(await inspect(original.operationId), original);
  mark('PostgreSQL restart preserves results and feed position', {
    operations: states.map((state) => ({
      operationId: state.operationId,
      executions: state.executions,
      completedAt: state.result.completedAt,
    })),
  });
  const frontendId = composeRun(['ps', '-q', 'frontend']).trim();
  const gateway = JSON.parse(docker(['inspect', frontendId]))[0];
  const backend = JSON.parse(docker(['inspect', composeRun(['ps', '-q', 'backend']).trim()]))[0];
  const network = Object.keys(backend.NetworkSettings.Networks)[0];
  const oldAddress = backend.NetworkSettings.Networks[network].IPAddress;
  composeRun(['rm', '--stop', '--force', 'backend']);
  // Reserve the released address so this checks DNS changes rather than address reuse.
  const fixture = docker([
    'run',
    '--detach',
    '--name',
    'system-integration-dns-' + randomUUID(),
    '--label',
    'com.azhukov.integration.test=recovery-dns',
    '--network',
    network,
    '--ip',
    oldAddress,
    '--memory',
    '16m',
    '--cpus',
    '0.05',
    '--read-only',
    '--entrypoint',
    '/bin/sleep',
    gateway.Image,
    '120',
  ]).trim();
  try {
    composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']);
    const current = JSON.parse(docker(['inspect', composeRun(['ps', '-q', 'backend']).trim()]))[0];
    const newAddress = current.NetworkSettings.Networks[network].IPAddress;
    assert.notEqual(newAddress, oldAddress);
    const frontend = localOrigin(process.env.SI_FRONTEND_URL || 'http://127.0.0.1:19673');
    await waitFor(
      'frontend discovers the new backend address',
      async () => {
        const response = await fetch(frontend + '/api/session', {
          headers: { Connection: 'close' },
          signal: AbortSignal.timeout(5000),
        });
        return response.status === 401 && (await response.json()).code === 'SESSION_REQUIRED';
      },
      20_000,
    );
    assert.equal(composeRun(['ps', '-q', 'frontend']).trim(), frontendId);
    mark('Frontend follows a changed backend IP without restarting', {
      oldAddress,
      newAddress,
      frontendUnchanged: true,
    });
  } finally {
    docker(['rm', '--force', fixture]);
  }
  api = await login();
  await fault('REQ-830005', 'UNAVAILABLE');
  const burst = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const created = await api.command('POST', '/api/tasks', {
        title: 'Graceful shutdown ' + index,
        request: { reference: 'REQ-830005', quantity: 25 },
      });
      return api.get('/api/tasks/' + created.taskId);
    }),
  );
  const shutdownSince = new Date().toISOString();
  composeRun(['stop', 'backend', 'emulator']);
  const exits = ['backend', 'emulator'].map((service) => {
    const id = composeRun(['ps', '--all', '-q', service]).trim();
    const state = JSON.parse(docker(['inspect', '--format', '{{json .State}}', id]));
    assert.ok([0, 143].includes(state.ExitCode), service + ' exited unexpectedly: ' + state.ExitCode);
    assert.equal(state.OOMKilled, false);
    const shutdownLog = docker(['logs', '--since', shutdownSince, id]);
    assert.match(shutdownLog, /Graceful shutdown complete/, service + ' HTTP shutdown did not finish');
    assert.match(shutdownLog, /HikariPool-1 - Shutdown completed/, service + ' database pool did not close');
    return { service, exitCode: state.ExitCode, httpShutdownComplete: true, databasePoolClosed: true };
  });
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend', 'emulator']);
  api = await login();
  await fault('REQ-830005');
  for (const item of burst) {
    // Recovery can require GET then PUT, each after the contractual 60 s maximum backoff.
    await completed(item, 150_000);
    assert.equal((await inspect(item.operationId)).executions, 1);
  }
  mark('Graceful stop preserves eight queued operations and resumes each exactly once', {
    exits,
    operations: burst.length,
  });
  const poolLatch = await hold('app', 'LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE;');
  await poolLatch.ready;
  const reads = Array.from({ length: 16 }, () =>
    api.get('/api/tasks/' + task.taskId).then(
      () => ({ status: 200 }),
      (error) => ({ status: error.status || 0, code: error.code || error.name }),
    ),
  );
  try {
    const first = await Promise.race(reads);
    assert.equal(first.status, 503, 'Pool exhaustion must not become an authorization error');
    assert.equal(first.code, 'SERVICE_UNAVAILABLE');
  } finally {
    await poolLatch.release();
  }
  const outcomes = await Promise.all(reads);
  assert.ok(outcomes.some((result) => result.status === 503));
  assert.ok(
    outcomes.every(
      (result) => result.status === 200 || (result.status === 503 && result.code === 'SERVICE_UNAVAILABLE'),
    ),
  );
  assert.equal((await api.get('/api/tasks/' + task.taskId)).taskId, task.taskId);
  mark('HTTP pool exhaustion returns 503 and the same session recovers after release', {
    requests: outcomes.length,
    unavailable: outcomes.filter((result) => result.status === 503).length,
  });

  const bounded = await create('REQ-830020', 'UNAVAILABLE');
  const series = () =>
    queryJson(
      'app',
      "SELECT json_build_object('total',attempts,'series',automatic_attempts) FROM delivery_queue WHERE operation_id=" +
        sqlQuote(bounded.operationId),
    );
  const advance = () =>
    query(
      'app',
      'UPDATE delivery_queue SET due_at=clock_timestamp() WHERE operation_id=' +
        sqlQuote(bounded.operationId) +
        ' AND claim_id IS NULL;',
    );
  await waitFor('second attempt persisted', () => {
    advance();
    return series().total >= 2;
  });
  composeRun(['restart', 'backend']);
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']);
  api = await login();
  await waitFor('five attempts pause after restart', async () => {
    advance();
    return (await api.get('/api/tasks/' + bounded.taskId)).deliveryStatus === 'NEEDS_REVIEW';
  });
  assert.deepEqual(series(), { total: 5, series: 5 });
  composeRun(['restart', 'backend']);
  composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend']);
  api = await login();
  await fault('REQ-830020');
  advance();
  const witness = await create('REQ-830021');
  await completed(witness);
  assert.equal((await api.get('/api/tasks/' + bounded.taskId)).deliveryStatus, 'NEEDS_REVIEW');
  assert.deepEqual(series(), { total: 5, series: 5 });
  mark('Automatic series survives restarts before and after exhaustion without a sixth call', {
    taskId: bounded.taskId,
    operationId: bounded.operationId,
    attempts: series(),
    healthyWitness: witness.operationId,
  });

  const operator = await login('operator');
  const snapshot = await operator.command('POST', '/api/tasks/' + bounded.taskId + '/reconciliations');
  const issue = await operator.get('/api/exchange/issues/' + snapshot.issueId);
  const retryInput = {
    expectedIssueRevision: issue.issueRevision,
    reconciliationId: snapshot.reconciliationId,
    reason: 'Recovery: connection restored and absence verified',
  };
  const retryKey = randomUUID(),
    retryPath = '/api/exchange/issues/' + issue.issueId + '/retry';
  const resumed = await operator.command('POST', retryPath, retryInput, retryKey);
  await waitFor('new series first GET persisted', () => series().total >= 6);
  const beforeReplay = series();
  assert.deepEqual(await operator.command('POST', retryPath, retryInput, retryKey), resumed);
  const afterReplay = series();
  assert.ok(afterReplay.total >= beforeReplay.total);
  assert.equal(afterReplay.total - afterReplay.series, 5, 'Replay must not reset the series again');
  await completed(bounded);
  const numbers = query(
    'app',
    "SELECT string_agg(number::text,',' ORDER BY number) FROM delivery_attempts WHERE operation_id=" +
      sqlQuote(bounded.operationId),
  );
  assert.equal(numbers, '1,2,3,4,5,6,7');
  assert.equal((await inspect(bounded.operationId)).executions, 1);
  assert.equal(
    query(
      'app',
      'SELECT count(*) FROM task_history WHERE task_id=' + sqlQuote(bounded.taskId) + " AND event_type='RETRY_QUEUED';",
    ),
    '1',
  );
  mark('Fresh operator continuation and lost-response replay preserve one series and one execution', {
    taskId: bounded.taskId,
    operationId: bounded.operationId,
    numbers,
    executions: 1,
  });

  receipt.passed = true;
} catch (error) {
  receipt.error = { name: error.name, message: error.message };
  throw error;
} finally {
  const cleanupErrors = [];
  for (const holder of [...holders]) {
    try {
      await holder.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    composeRun(['up', '-d', '--no-build', '--no-deps', '--wait', 'backend', 'emulator']);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    receipt.passed = false;
    receipt.cleanupErrors = cleanupErrors.map((error) => error.message);
  }
  receipt.finishedAt = new Date().toISOString();
  await mkdir(new URL('../results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../results/recovery.json', import.meta.url), JSON.stringify(receipt, null, 2));
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Recovery cleanup requires attention');
}
