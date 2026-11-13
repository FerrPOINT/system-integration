import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { prepareNf08Clients, runNf08Workload, validateNf08Workload, verifyClientTasks } from './nf08-workload.mjs';
import { ApiFailure, localOrigin } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { observeLoad, drainLoad, loadIntegrity, pipelineSummary } from './metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the candidate before the NF08 qualification');
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const externalOrigin = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
if (dataset.origin !== origin || dataset.initialCount !== 5000) throw new Error('Prepare the exact 5000-record dataset on this test origin');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');

const resources = qualifiedLoadEnvironment(sourceCommit);
const resourceTotal = { cpu: resources.reduce((sum, item) => sum + item.cpu, 0), memory: resources.reduce((sum, item) => sum + item.memory, 0) };

const externalDriver = process.env.SI_LOAD_PROFILE === 'nf08-external';
let externalFinished = false;
if (externalDriver) process.stdin.once('end', () => { if (!externalFinished) process.exit(1); });
const clients = await prepareNf08Clients(dataset, origin, process.env.SI_DEMO_PASSWORD);
const observation = await observeLoad(resources);
const serverWindowStartedAt = new Date().toISOString();
let workload;
try {
  if (externalDriver) {
    const input = createInterface({ input: process.stdin, terminal: false });
    console.log(JSON.stringify({ type: 'nf08-start', sourceCommit, serverWindowStartedAt, controllerPid: process.pid }));
    let line;
    try { for await (const item of input) { line = item; break; } }
    finally { input.close(); process.stdin.resume(); }
    if (!line) throw new Error('External driver ended without a workload report');
    const message = JSON.parse(line);
    if (message.type !== 'nf08-workload' || message.sourceCommit !== sourceCommit)
      throw new Error('External driver report does not match the qualified NF08 profile');
    workload = message.workload;
  } else workload = await runNf08Workload(clients);
} finally { await observation.stop(); }
validateNf08Workload(workload);
const { startedAt, finishedAt, measurements, created, allCreated, warmupErrors, generator } = workload;
if (externalDriver) {
  for (const [index, final] of workload.finalTasks.entries()) {
    const client = clients[index];
    if (final.taskId !== client.task.taskId || final.userId !== client.userId)
      throw new Error('External driver changed its allocated owner/task');
    client.task = { ...client.task, title: final.title, titleRevision: final.titleRevision };
  }
}
const p95 = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.ceil(0.95 * sorted.length) - 1] : null; };
const externalErrors = {};
const renamed = await verifyClientTasks(clients);
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

const pipeline = await pipelineSummary(resources, serverWindowStartedAt);

const counts = measurements.map(stat => stat.latencies.length);
const reads = measurements.slice(0, 2).flatMap(stat => stat.latencies);
const writes = measurements.slice(2).flatMap(stat => stat.latencies);
const errors = measurements.reduce((total, stat) => total + Object.values(stat.errors).reduce((a, b) => a + b, 0), 0);
const report = {
  sourceCommit, driver: externalDriver ? 'external-ssh' : 'local', generator, serverWindowStartedAt,
  startedAt, finishedAt, clients: 20, warmupSeconds: 30, measuredSeconds: 120, initialCount: 5000, resources, warmupErrors,
  resourceTotal, idempotency, renamed, drain, finalIntegrity, pipeline, observation: { samples: observation.samples, errors: observation.errors },
  operations: measurements.map(stat => ({ operation: stat.operation, count: stat.latencies.length, share: stat.latencies.length / counts.reduce((a, b) => a + b, 0),
    successes: stat.successes, errors: stat.errors, p95Ms: p95(stat.latencies) })),
  readP95Ms: p95(reads), writeP95Ms: p95(writes), errors,
  external: { ...external, acceptedPending: external.pending - external.notAccepted,
    pendingShare: created.length ? external.pending / created.length : null,
    errors: externalErrors, progressWaitStartedAt, progressWaitFinishedAt, externalProgressObserved,
    checkStartedAt: externalCheckStartedAt, checkFinishedAt: externalCheckFinishedAt },
};
report.sourceUnchanged = git('rev-parse', 'HEAD') === sourceCommit && !git('status', '--porcelain');
report.passed = observation.errors.length === 0 && observation.samples.every(sample => sample.containers.every(item => item.running && !item.oom && !item.restarted)) && idempotency.passed && report.sourceUnchanged && Object.keys(renamed.errors).length === 0 && errors === 0 && Object.keys(warmupErrors).length === 0 && counts.every(count => count > 0) && Math.max(...counts) - Math.min(...counts) <= 20 &&
  report.readP95Ms <= 2000 && report.writeP95Ms <= 3000 && Object.keys(externalErrors).length === 0 && external.completed > 0 && finalIntegrity.passed;
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
const output = new URL('../results/' + (externalDriver ? 'nf08-external' : 'nf08') + '.json', import.meta.url);
const serialized = JSON.stringify(report, null, 2);
await writeFile(output, serialized);
if (externalDriver) externalFinished = true;
if (externalDriver) console.log(JSON.stringify({ type: 'nf08-finished', sourceCommit, passed: report.passed,
  readP95Ms: report.readP95Ms, writeP95Ms: report.writeP95Ms, errors: report.errors,
  expectedRecords: finalIntegrity.expectedRecords, reportSha256: createHash('sha256').update(serialized).digest('hex') }));
else console.log(serialized);
if (!report.passed) process.exitCode = 1;
