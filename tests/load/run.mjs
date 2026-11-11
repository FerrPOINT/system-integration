import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin, parallel } from '../support/http.mjs';
import { loadEnvironment } from './environment.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the candidate before the NF08 qualification');
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19580');
const externalOrigin = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19581');
if (dataset.origin !== origin || dataset.initialCount !== 5000) throw new Error('Prepare the exact 5000-record dataset on this test origin');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');

const expected = { backend: [0.8, 1536 * 1048576], postgres: [0.8, 1536 * 1048576], emulator: [0.4, 1024 * 1048576] };
const resources = loadEnvironment();
for (const resource of resources) {
  const [cpu, memory] = expected[resource.service];
  if (resource.cpu !== cpu || resource.memory !== memory) throw new Error(`Incorrect actual resource limits for ${resource.service}`);
  if (resource.service !== 'postgres' && resource.sourceCommit !== sourceCommit)
    throw new Error(`The ${resource.service} image is not labelled with the qualified source commit`);
}

await Promise.all(dataset.accounts.map(async account => {
  const session = new ApiSession(origin); await session.login(account.username, process.env.SI_DEMO_PASSWORD);
  let total = 0;
  for (let page = 0; ; page++) {
    const items = await session.get(`/api/tasks?page=${page}`); total += items.items.length;
    if (!items.hasNext) break;
  }
  if (total !== 2500) throw new Error('The initial record count changed before measurement');
  if ((await session.get('/api/tasks?businessStatus=SUCCEEDED&page=0')).items.length !== 20)
    throw new Error('Each initiator needs a full successful first page');
}));

const clients = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
  const owner = index % 2;
  const session = new ApiSession(origin);
  await session.login(dataset.accounts[owner].username, process.env.SI_DEMO_PASSWORD);
  const task = await session.get('/api/tasks/' + dataset.accounts[owner].tasks[Math.floor(index / 2)]);
  return { index, session, task, action: index % 4, counter: 0 };
}));
const measurements = ['list', 'card', 'create', 'rename'].map(operation => ({ operation, latencies: [], successes: 0, errors: {} }));
const created = [];
const warmupErrors = {};
let serial = 200000;
const startedAt = new Date().toISOString();
const warmEnd = performance.now() + 30_000;
const measureEnd = warmEnd + 120_000;
await Promise.all(clients.map(async client => {
  while (performance.now() < measureEnd) {
    const start = performance.now(); const measured = start >= warmEnd;
    const stat = measurements[client.action]; let createdId;
    try {
      if (client.action === 0) {
        const result = await client.session.get('/api/tasks?businessStatus=SUCCEEDED&page=0');
        if (result.items?.length !== 20 || result.items.some(task => task.businessStatus !== 'SUCCEEDED')) throw new ApiFailure(200, 'INVALID_LIST_PAGE');
      }
      if (client.action === 1) {
        const result = await client.session.get('/api/tasks/' + client.task.taskId);
        if (result.taskId !== client.task.taskId || result.titleRevision < client.task.titleRevision) throw new ApiFailure(200, 'INVALID_TASK_STATE');
        client.task = result;
      }
      if (client.action === 2) {
        if (serial > 999999) throw new Error('REFERENCE_RANGE_EXHAUSTED');
        const result = await client.session.command('POST', '/api/tasks', {
          title: `NF08 client ${client.index} create ${client.counter}`, request: { reference: `REQ-${serial++}`, quantity: 25 },
        });
        if (typeof result?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
        createdId = result.taskId;
      }
      if (client.action === 3) {
        const result = await client.session.command('PATCH', '/api/tasks/' + client.task.taskId, {
          title: `NF08 client ${client.index} rename ${client.counter}`, expectedTitleRevision: client.task.titleRevision,
        });
        client.task.titleRevision = result.titleRevision;
      }
      if (measured) { stat.successes++; if (createdId) created.push({ taskId: createdId, client: client.index }); }
    } catch (error) {
      const code = error instanceof ApiFailure ? `${error.status}:${error.code}` : error.name;
      if (measured) {
        stat.errors[code] = (stat.errors[code] || 0) + 1;
      } else warmupErrors[code] = (warmupErrors[code] || 0) + 1;
    } finally {
      if (measured) stat.latencies.push(performance.now() - start);
      client.action = (client.action + 1) % 4; client.counter++;
    }
  }
}));

const finishedAt = new Date().toISOString();
const p95 = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(0.95 * sorted.length) - 1] : null; };
const durations = []; const externalErrors = {}; let pending = 0, notAccepted = 0;
const externalCheckStartedAt = new Date().toISOString();
await parallel(created, 8, async item => {
  try {
    const task = await clients[item.client].session.get('/api/tasks/' + item.taskId);
    const response = await fetch(externalOrigin + '/operations/' + task.operationId, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) {
      const problem = await response.json();
      if (problem.status !== 404 || problem.code !== 'OPERATION_NOT_FOUND' || typeof problem.title !== 'string' ||
          task.deliveryStatus === 'ACKNOWLEDGED' || task.businessStatus !== 'PENDING')
        throw new ApiFailure(404, 'EXTERNAL_STATE_CONTRADICTS_LOCAL');
      pending++; notAccepted++; return;
    }
    if (!response.ok) throw new ApiFailure(response.status, 'EXTERNAL_STATE_READ_FAILED');
    const state = await response.json();
    if (state.operationId !== task.operationId || state.request?.reference !== task.request.reference || state.request?.quantity !== task.request.quantity || state.executions > 1)
      throw new ApiFailure(0, 'EXTERNAL_IDENTITY_OR_EXECUTION_CONFLICT');
    if (state.executions === 0) {
      if (state.result !== null) throw new ApiFailure(0, 'RESULT_WITHOUT_EXECUTION');
      pending++; return;
    }
    if (state.executions !== 1 || state.result?.status !== 'SUCCEEDED' || !state.result.completedAt)
      throw new ApiFailure(0, 'INVALID_EXTERNAL_RESULT');
    if (state.result.operationId !== task.operationId || state.result.request?.reference !== task.request.reference || state.result.request?.quantity !== task.request.quantity)
      throw new ApiFailure(0, 'EXTERNAL_RESULT_IDENTITY_CONFLICT');
    const elapsed = Date.parse(state.result.completedAt) - Date.parse(task.createdAt);
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new ApiFailure(0, 'INVALID_EXTERNAL_TIME');
    durations.push(elapsed);
  } catch (error) {
    const code = error instanceof ApiFailure ? error.code : error.name;
    externalErrors[code] = (externalErrors[code] || 0) + 1;
  }
});
const counts = measurements.map(stat => stat.latencies.length);
const reads = measurements.slice(0, 2).flatMap(stat => stat.latencies);
const writes = measurements.slice(2).flatMap(stat => stat.latencies);
const errors = measurements.reduce((total, stat) => total + Object.values(stat.errors).reduce((a, b) => a + b, 0), 0);
const report = {
  sourceCommit, startedAt, finishedAt, clients: 20, warmupSeconds: 30, measuredSeconds: 120, initialCount: 5000, resources, warmupErrors,
  resourceTotal: { cpu: resources.reduce((sum, item) => sum + item.cpu, 0), memory: resources.reduce((sum, item) => sum + item.memory, 0) },
  operations: measurements.map(stat => ({ operation: stat.operation, count: stat.latencies.length, share: stat.latencies.length / counts.reduce((a, b) => a + b, 0),
    successes: stat.successes, errors: stat.errors, p95Ms: p95(stat.latencies) })),
  readP95Ms: p95(reads), writeP95Ms: p95(writes), errors,
  external: { checked: created.length, completed: durations.length, pending, notAccepted, acceptedPending: pending - notAccepted,
    pendingShare: created.length ? pending / created.length : null,
    errors: externalErrors, p95Ms: p95(durations), checkStartedAt: externalCheckStartedAt, checkFinishedAt: new Date().toISOString() },
};
report.sourceUnchanged = git('rev-parse', 'HEAD') === sourceCommit && !git('status', '--porcelain');
report.passed = report.sourceUnchanged && errors === 0 && Object.keys(warmupErrors).length === 0 && counts.every(count => count > 0) && Math.max(...counts) - Math.min(...counts) <= 20 &&
  report.readP95Ms <= 2000 && report.writeP95Ms <= 3000 && Object.keys(externalErrors).length === 0 && durations.length > 0;
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
const output = new URL('../results/nf08.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
