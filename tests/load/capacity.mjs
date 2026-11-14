import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin, parallel } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { loadSnapshot, observeLoad, pipelineSummary, drainLoad, loadIntegrity } from './metrics.mjs';

import { verifyClientTasks } from './nf08-workload.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the capacity candidate before qualification');
const mode = process.env.SI_CAPACITY_MODE || 'read';
const clientCount = Number(process.env.SI_CAPACITY_CLIENTS || '20');
if (!['read', 'mixed'].includes(mode) || ![20, 40, 80].includes(clientCount))
  throw new Error('Select one capacity stage: SI_CAPACITY_MODE=read|mixed and SI_CAPACITY_CLIENTS=20|40|80');
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const externalOrigin = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
if (dataset.profile !== 'capacity' || dataset.initialCount !== 10000 || dataset.origin !== origin)
  throw new Error('Prepare the exact 10000-record capacity dataset');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
const resources = qualifiedLoadEnvironment(sourceCommit);
const initial = await loadSnapshot(resources);
if (
  initial.app.records !== 10000 ||
  initial.app.pending ||
  initial.emulator.executed !== 10000 ||
  initial.emulator.unpublished
)
  throw new Error('The initial dataset must be fully executed and published');
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
};
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const stages = [],
  integrityErrors = [];
let serial = 300000;

async function clientsFor(count) {
  const clients = new Array(count);
  // Authentication is preparation, not an unbounded BCrypt burst in the API profile.
  await parallel(
    Array.from({ length: count }, (_, index) => index),
    4,
    async (index) => {
      const account = dataset.accounts[index % 2];
      const session = new ApiSession(origin);
      const identity = await session.login(account.username, process.env.SI_DEMO_PASSWORD);
      const task = await session.get('/api/tasks/' + account.tasks[Math.floor(index / 2)]);
      clients[index] = { index, session, userId: identity.userId, task, counter: 0 };
    },
  );
  return clients;
}

async function stage(mode, count) {
  const clients = await clientsFor(count);
  const observation = await observeLoad(resources);
  const before = observation.samples[0];
  const operations = ['list', 'card', 'create', 'rename'].map((operation) => ({
    operation,
    latencies: [],
    errors: {},
    successes: 0,
  }));
  const created = [],
    warmupErrors = {};
  const startedAt = new Date().toISOString(),
    warmEnd = performance.now() + 15000,
    end = warmEnd + 60000;
  let reason,
    finishedAt,
    measuredSeconds = 0;
  try {
    await Promise.all(
      clients.map(async (client) => {
        let action = client.index % (mode === 'read' ? 2 : 4);
        while (performance.now() < end && !reason) {
          const last = observation.samples.at(-1);
          if (observation.errors.length) {
            reason = 'observation-error';
            break;
          }
          if (last.containers.some((item) => !item.running || item.oom || item.restarted)) {
            reason = 'container-failure';
            break;
          }
          if (last.app.pending > 20000 || last.app.oldestPendingSeconds > 180) {
            reason = 'queue-safety-limit';
            break;
          }
          const start = performance.now(),
            measured = start >= warmEnd,
            stat = operations[action];
          try {
            if (action === 0) {
              const result = await client.session.get('/api/tasks?businessStatus=SUCCEEDED&page=0');
              if (
                result.items?.length !== 20 ||
                result.totalItems < 5000 ||
                result.totalPages !== Math.ceil(result.totalItems / 20) ||
                result.items.some((task) => task.businessStatus !== 'SUCCEEDED' || task.ownerId !== client.userId)
              )
                throw new ApiFailure(200, 'INVALID_LIST_PAGE');
            } else if (action === 1) {
              const result = await client.session.get('/api/tasks/' + client.task.taskId);
              if (
                result.taskId !== client.task.taskId ||
                result.ownerId !== client.userId ||
                result.titleRevision < client.task.titleRevision
              )
                throw new ApiFailure(200, 'INVALID_TASK_STATE');
              client.task = result;
            } else if (action === 2) {
              if (serial > 999999) throw new Error('REFERENCE_RANGE_EXHAUSTED');
              const reference = 'REQ-' + serial++;
              const title = 'Capacity client ' + client.index + ' create ' + client.counter;
              const result = await client.session.command('POST', '/api/tasks', {
                title,
                request: { reference, quantity: 25 },
              });
              if (typeof result?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
              created.push({ taskId: result.taskId, client: client.index, ownerId: client.userId, title, reference });
            } else {
              const input = {
                title: 'Capacity client ' + client.index + ' rename ' + client.counter,
                expectedTitleRevision: client.task.titleRevision,
              };
              const result = await client.session.command('PATCH', '/api/tasks/' + client.task.taskId, input);
              if (result.title !== input.title || result.titleRevision !== input.expectedTitleRevision + 1)
                throw new ApiFailure(200, 'INVALID_RENAME_RESULT');
              client.task.titleRevision = result.titleRevision;
              client.task.title = result.title;
            }
            if (measured) stat.successes++;
          } catch (error) {
            const code = error instanceof ApiFailure ? error.status + ':' + error.code : error.name;
            const errors = measured ? stat.errors : warmupErrors;
            errors[code] = (errors[code] || 0) + 1;
            reason = 'request-errors';
          } finally {
            if (measured) stat.latencies.push(performance.now() - start);
            action = (action + 1) % (mode === 'read' ? 2 : 4);
            client.counter++;
          }
        }
      }),
    );
  } finally {
    finishedAt = new Date().toISOString();
    measuredSeconds = Math.max(0, Math.min(performance.now(), end) - warmEnd) / 1000;
    await observation.stop();
  }
  const renamed = await verifyClientTasks(clients);
  if (Object.keys(renamed.errors).length) reason = 'rename-state-error';
  const reads = operations.slice(0, 2).flatMap((item) => item.latencies);
  const writes = operations.slice(2).flatMap((item) => item.latencies);
  if (!reason && (!reads.length || p95(reads) > 2000 || (mode === 'mixed' && (!writes.length || p95(writes) > 3000))))
    reason = 'latency-limit';
  const drain = await drainLoad(resources, 180000);
  const after = drain.samples.at(-1),
    drained = drain.drained;
  if (!drained) reason ||= drain.stoppedFor;
  let external, databaseIntegrity;
  try {
    external = await verifyCreatedTasks(created, clients, externalOrigin, drained);
    if (Object.keys(external.errors).length) throw new Error(Object.keys(external.errors).join(','));
  } catch (error) {
    integrityErrors.push(error.message);
    reason = 'integrity-error';
  }
  if (drained && reason !== 'integrity-error') {
    try {
      if (
        after.app.records !== after.emulator.accepted ||
        after.emulator.accepted !== after.emulator.executed ||
        after.emulator.duplicateExecutions
      )
        throw new Error('GLOBAL_OPERATION_COUNTS_DIFFER');
      try {
        await clients[1].session.get('/api/tasks/' + clients[0].task.taskId);
        throw new Error('FOREIGN_TASK_VISIBLE');
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
      }
      const input = { title: 'Capacity replay', request: { reference: 'REQ-999990', quantity: 25 } },
        key = crypto.randomUUID();
      const first = await clients[0].session.command('POST', '/api/tasks', input, key);
      const replay = await clients[0].session.command('POST', '/api/tasks', input, key);
      if (first.taskId !== replay.taskId) throw new Error('IDEMPOTENCY_REPLAY_CHANGED');
      // Include this independent verification command in this stage's final integrity check.
      const replayDeadline = Date.now() + 30000;
      while (Date.now() < replayDeadline) {
        const item = await clients[0].session.get('/api/tasks/' + first.taskId);
        if (item.businessStatus === 'SUCCEEDED') break;
        await pause(500);
      }
      if ((await clients[0].session.get('/api/tasks/' + first.taskId)).businessStatus !== 'SUCCEEDED')
        throw new Error('REPLAY_OPERATION_DID_NOT_COMPLETE');
      const verifiedReplay = await verifyCreatedTasks(
        [
          {
            taskId: first.taskId,
            client: 0,
            ownerId: clients[0].userId,
            title: input.title,
            reference: input.request.reference,
          },
        ],
        clients,
        externalOrigin,
        true,
      );
      if (Object.keys(verifiedReplay.errors).length || verifiedReplay.completed !== 1)
        throw new Error('REPLAY_INTEGRITY_FAILED');
      databaseIntegrity = await loadIntegrity(resources);
      verifyFinishedSnapshot(databaseIntegrity, before.app.records + created.length + 1);
    } catch (error) {
      integrityErrors.push(error.message);
      reason = 'integrity-error';
    }
  }
  const result = {
    mode,
    clients: count,
    startedAt,
    finishedAt,
    warmupSeconds: 15,
    plannedMeasuredSeconds: 60,
    measuredSeconds,
    recordsBefore: before.app.records,
    recordsAfter: after.app.records,
    readP95Ms: p95(reads),
    writeP95Ms: p95(writes),
    throughput: measuredSeconds
      ? operations.reduce((sum, item) => sum + item.latencies.length, 0) / measuredSeconds
      : 0,
    operations: operations.map((item) => ({
      ...item,
      count: item.latencies.length,
      p95Ms: p95(item.latencies),
      latencies: undefined,
    })),
    warmupErrors,
    observation: { samples: observation.samples, errors: observation.errors },
    drain,
    external,
    renamed,
    databaseIntegrity,
    pipeline: await pipelineSummary(resources, startedAt),
    stoppedFor: reason || null,
    passed: !reason,
  };
  console.log(
    mode +
      ' ' +
      count +
      ' clients: ' +
      (result.passed ? 'PASS' : reason) +
      ', read p95=' +
      result.readP95Ms +
      ', pending=' +
      after.app.pending,
  );
  return result;
}

stages.push(await stage(mode, clientCount));
const noUnexpectedErrors = stages.every((item) =>
  Object.keys(item.warmupErrors)
    .concat(item.operations.flatMap((op) => Object.keys(op.errors)))
    .every((code) => /^(503:|429:|TimeoutError$|AbortError$)/.test(code)),
);
const report = {
  profile: 'capacity',
  sourceCommit,
  mode,
  clients: clientCount,
  initialCount: 10000,
  resources,
  stages,
  integrityErrors,
  sourceUnchanged: git('rev-parse', 'HEAD') === sourceCommit && !git('status', '--porcelain'),
  preparation: 'One stage per fresh 10000-record dataset; drain and verify before resetting for the next stage',
};
report.passed =
  report.sourceUnchanged &&
  noUnexpectedErrors &&
  integrityErrors.length === 0 &&
  stages.every(
    (item) =>
      item.observation.errors.length === 0 &&
      item.stoppedFor !== 'container-failure' &&
      item.observation.samples.every((sample) =>
        sample.containers.every((container) => container.running && !container.oom && !container.restarted),
      ),
  ) &&
  stages.every((item) => item.passed && item.recordsBefore === 10000);
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL('../results/capacity.json', import.meta.url), JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
