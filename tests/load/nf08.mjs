import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin, parallel } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { observeLoad, drainLoad, loadIntegrity } from './metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the candidate before the NF08 qualification');
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19580');
const externalOrigin = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19581');
if (dataset.origin !== origin || dataset.initialCount !== 5000) throw new Error('Prepare the exact 5000-record dataset on this test origin');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');

const resources = qualifiedLoadEnvironment(sourceCommit);
const resourceTotal = { cpu: resources.reduce((sum, item) => sum + item.cpu, 0), memory: resources.reduce((sum, item) => sum + item.memory, 0) };

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

const clients = new Array(20);
await parallel(Array.from({ length: 20 }, (_, index) => index), 4, async index => {
  const owner = index % 2;
  const session = new ApiSession(origin);
  const identity = await session.login(dataset.accounts[owner].username, process.env.SI_DEMO_PASSWORD);
  const task = await session.get('/api/tasks/' + dataset.accounts[owner].tasks[Math.floor(index / 2)]);
  clients[index] = { index, session, userId: identity.userId, task, action: index % 4, counter: 0 };
});
const measurements = ['list', 'card', 'create', 'rename'].map(operation => ({ operation, latencies: [], successes: 0, errors: {} }));
const created = [], allCreated = [];
const warmupErrors = {};
let serial = 200000;
const observation = await observeLoad(resources);
const startedAt = new Date().toISOString();
const warmEnd = performance.now() + 30_000;
const measureEnd = warmEnd + 120_000;
await Promise.all(clients.map(async client => {
  while (performance.now() < measureEnd) {
    const start = performance.now(); const measured = start >= warmEnd;
    const stat = measurements[client.action]; let createdTask;
    try {
      if (client.action === 0) {
        const result = await client.session.get('/api/tasks?businessStatus=SUCCEEDED&page=0');
        if (result.items?.length !== 20 || result.totalItems < 2500 || result.totalPages !== Math.ceil(result.totalItems / 20) || result.items.some(task => task.businessStatus !== 'SUCCEEDED' || task.ownerId !== client.userId)) throw new ApiFailure(200, 'INVALID_LIST_PAGE');
      }
      if (client.action === 1) {
        const result = await client.session.get('/api/tasks/' + client.task.taskId);
        if (result.taskId !== client.task.taskId || result.ownerId !== client.userId || result.titleRevision < client.task.titleRevision) throw new ApiFailure(200, 'INVALID_TASK_STATE');
        client.task = result;
      }
      if (client.action === 2) {
        if (serial > 999999) throw new Error('REFERENCE_RANGE_EXHAUSTED');
        const input = {
          title: `NF08 client ${client.index} create ${client.counter}`, request: { reference: `REQ-${serial++}`, quantity: 25 },
        };
        const result = await client.session.command('POST', '/api/tasks', input);
        if (typeof result?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
        createdTask = { taskId: result.taskId, client: client.index, ownerId: client.userId, title: input.title, reference: input.request.reference };
        allCreated.push(createdTask);
      }
      if (client.action === 3) {
        const result = await client.session.command('PATCH', '/api/tasks/' + client.task.taskId, {
          title: `NF08 client ${client.index} rename ${client.counter}`, expectedTitleRevision: client.task.titleRevision,
        });
        client.task.titleRevision = result.titleRevision;
      }
      if (measured) { stat.successes++; if (createdTask) created.push(createdTask); }
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
await observation.stop();
const p95 = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(0.95 * sorted.length) - 1] : null; };
const externalErrors = {};
const progressWaitStartedAt = new Date().toISOString();
let externalProgressObserved = false;
if (created.length) {
  const first = created[0], deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      const task = await clients[first.client].session.get('/api/tasks/' + first.taskId);
      if (task.businessStatus === 'SUCCEEDED') { externalProgressObserved = true; break; }
      if (task.businessStatus === 'REJECTED') throw new ApiFailure(0, 'UNEXPECTED_BUSINESS_REJECTION');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!externalProgressObserved) externalErrors.PROGRESS_CHECK_TIMEOUT = 1;
  } catch (error) {
    externalErrors[error instanceof ApiFailure ? error.code : error.name] = 1;
  }
}
const progressWaitFinishedAt = new Date().toISOString();
const externalCheckStartedAt = new Date().toISOString();
const external = await verifyCreatedTasks(created, clients, externalOrigin, false);
for (const [code, count] of Object.entries(external.errors)) externalErrors[code] = (externalErrors[code] || 0) + count;
const externalCheckFinishedAt = new Date().toISOString();
// The measured generator has stopped; repeated commands must add only one record.
const repeatedKey = crypto.randomUUID();
const repeatedInput = { title: 'NF08 concurrent idempotency', request: { reference: 'REQ-999991', quantity: 25 } };
const sameOwner = clients.filter(client => client.index % 2 === 0);
const beforeRepeated = await sameOwner[0].session.get('/api/tasks');
const replies = await Promise.all(Array.from({ length: 20 }, (_, i) =>
  sameOwner[i % sameOwner.length].session.command('POST', '/api/tasks', repeatedInput, repeatedKey)));
const repeatedIds = new Set(replies.map(reply => reply.taskId));
const replay = await sameOwner[0].session.command('POST', '/api/tasks', repeatedInput, repeatedKey);
let conflictRejected = false;
try {
  await sameOwner[0].session.command('POST', '/api/tasks', { ...repeatedInput, title: 'Different command' }, repeatedKey);
} catch (error) {
  if (!(error instanceof ApiFailure) || error.status !== 409 || error.code !== 'IDEMPOTENCY_CONFLICT') throw error;
  conflictRejected = true;
}
const afterRepeated = await sameOwner[0].session.get('/api/tasks');
const idempotency = { concurrentRequests: 20, uniqueTaskIds: repeatedIds.size,
  countIncrease: afterRepeated.totalItems - beforeRepeated.totalItems, conflictRejected,
  replaySameTask: replay.taskId === replies[0].taskId };
idempotency.passed = idempotency.uniqueTaskIds === 1 && idempotency.countIncrease === 1 && idempotency.conflictRejected && idempotency.replaySameTask;

allCreated.push({ taskId: replies[0].taskId, client: sameOwner[0].index, ownerId: sameOwner[0].userId,
  title: repeatedInput.title, reference: repeatedInput.request.reference });
const drain = await drainLoad(resources);
const finalIntegrity = { passed: false, expectedRecords: 5000 + allCreated.length };
try {
  finalIntegrity.snapshot = await loadIntegrity(resources);
  verifyFinishedSnapshot(finalIntegrity.snapshot, finalIntegrity.expectedRecords);
  finalIntegrity.created = await verifyCreatedTasks(allCreated, clients, externalOrigin, true);
  const verified = finalIntegrity.created;
  finalIntegrity.passed = drain.drained && Object.keys(verified.errors).length === 0 &&
    verified.completed === allCreated.length && verified.pending === 0;
} catch (error) { finalIntegrity.error = error instanceof ApiFailure ? error.code : error.name; }

const counts = measurements.map(stat => stat.latencies.length);
const reads = measurements.slice(0, 2).flatMap(stat => stat.latencies);
const writes = measurements.slice(2).flatMap(stat => stat.latencies);
const errors = measurements.reduce((total, stat) => total + Object.values(stat.errors).reduce((a, b) => a + b, 0), 0);
const report = {
  sourceCommit, startedAt, finishedAt, clients: 20, warmupSeconds: 30, measuredSeconds: 120, initialCount: 5000, resources, warmupErrors,
  resourceTotal, idempotency, drain, finalIntegrity, observation: { samples: observation.samples, errors: observation.errors },
  operations: measurements.map(stat => ({ operation: stat.operation, count: stat.latencies.length, share: stat.latencies.length / counts.reduce((a, b) => a + b, 0),
    successes: stat.successes, errors: stat.errors, p95Ms: p95(stat.latencies) })),
  readP95Ms: p95(reads), writeP95Ms: p95(writes), errors,
  external: { ...external, acceptedPending: external.pending - external.notAccepted,
    pendingShare: created.length ? external.pending / created.length : null,
    errors: externalErrors, progressWaitStartedAt, progressWaitFinishedAt, externalProgressObserved,
    checkStartedAt: externalCheckStartedAt, checkFinishedAt: externalCheckFinishedAt },
};
report.sourceUnchanged = git('rev-parse', 'HEAD') === sourceCommit && !git('status', '--porcelain');
report.passed = observation.errors.length === 0 && observation.samples.every(sample => sample.containers.every(item => item.running && !item.oom && !item.restarted)) && idempotency.passed && report.sourceUnchanged && errors === 0 && Object.keys(warmupErrors).length === 0 && counts.every(count => count > 0) && Math.max(...counts) - Math.min(...counts) <= 20 &&
  report.readP95Ms <= 2000 && report.writeP95Ms <= 3000 && Object.keys(externalErrors).length === 0 && external.completed > 0 && finalIntegrity.passed;
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
const output = new URL('../results/nf08.json', import.meta.url);
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
