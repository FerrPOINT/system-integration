import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { observeLoad, loadSnapshot, drainLoad, loadIntegrity, pipelineSummary } from './metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';
import { runSteadyArrivals } from './steady-workload.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the steady-load candidate');
const rates = (process.env.SI_STEADY_RATES || '').split(',').map(Number);
const phaseSeconds = Number(process.env.SI_STEADY_PHASE_SECONDS || '300');
if (
  !rates.length ||
  rates.some((rate) => !Number.isInteger(rate) || rate < 1) ||
  !Number.isInteger(phaseSeconds) ||
  phaseSeconds < 1 ||
  rates.reduce((sum, rate) => sum + rate * phaseSeconds, 0) > 399000
)
  throw new Error(
    'Set positive integer SI_STEADY_RATES and SI_STEADY_PHASE_SECONDS within the finite request-reference range',
  );
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const externalOrigin = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
const resources = qualifiedLoadEnvironment(sourceCommit);
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
if (dataset.origin !== origin || dataset.profile !== 'steady' || dataset.initialCount !== 5000)
  throw new Error('Prepare the exact 5000-record steady dataset');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
const initial = await loadSnapshot(resources);
if (
  initial.app.records !== 5000 ||
  initial.app.pending ||
  initial.emulator.executed !== 5000 ||
  initial.emulator.unpublished
)
  throw new Error('The initial dataset must be fully executed and published');
const clients = [];
for (const [index, account] of dataset.accounts.entries()) {
  const session = new ApiSession(origin);
  const identity = await session.login(account.username, process.env.SI_DEMO_PASSWORD);
  clients.push({ index, session, userId: identity.userId });
}
const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
};
const maxInFlight = 64,
  created = [],
  phases = [];
let serial = 600000;
const observation = await observeLoad(resources);
const startedAt = new Date().toISOString();
const cpuBefore = process.cpuUsage();
function safetyStop() {
  if (observation.errors.length) return 'observation-error';
  const last = observation.samples.at(-1);
  if (last.containers.some((item) => !item.running || item.oom || item.restarted)) return 'container-failure';
  if (last.app.pending > 20000 || last.app.oldestPendingSeconds > 180) return 'queue-safety-limit';
  return null;
}
try {
  for (const rate of rates) {
    const before = await loadSnapshot(resources),
      phaseStartedAt = new Date().toISOString();
    const latencies = [],
      errors = {};
    let successes = 0;
    console.log('Steady phase: ' + rate + ' creates/s for ' + phaseSeconds + 's');
    const arrivals = await runSteadyArrivals({
      rate,
      durationMs: phaseSeconds * 1000,
      maxInFlight,
      shouldStop: safetyStop,
      perform: async () => {
        const sequence = serial++,
          client = clients[sequence % clients.length];
        const input = { title: 'Steady ' + sequence, request: { reference: 'REQ-' + sequence, quantity: 25 } };
        const beforeRequest = performance.now();
        try {
          const task = await client.session.command('POST', '/api/tasks', input);
          if (typeof task?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
          created.push({
            taskId: task.taskId,
            client: client.index,
            ownerId: client.userId,
            title: input.title,
            reference: input.request.reference,
          });
          successes++;
        } catch (error) {
          const code = error instanceof ApiFailure ? error.status + ':' + error.code : error.name;
          errors[code] = (errors[code] || 0) + 1;
        } finally {
          latencies.push(performance.now() - beforeRequest);
        }
      },
    });
    const after = await loadSnapshot(resources);
    phases.push({
      targetCreatesPerSecond: rate,
      plannedSeconds: phaseSeconds,
      startedAt: phaseStartedAt,
      finishedAt: new Date().toISOString(),
      arrivals: { ...arrivals, startDelaysMs: undefined, startDelayP95Ms: p95(arrivals.startDelaysMs) },
      successes,
      errors,
      createP95Ms: p95(latencies),
      before,
      after,
      pendingGrowth: after.app.pending - before.app.pending,
      passed:
        !arrivals.stoppedFor &&
        arrivals.missed === 0 &&
        arrivals.notOffered === 0 &&
        arrivals.started === arrivals.planned &&
        successes === arrivals.planned &&
        p95(latencies) <= 3000,
    });
    console.log('Steady phase complete: ' + successes + ' created; pending growth=' + phases.at(-1).pendingGrowth);
    if (arrivals.stoppedFor) break;
  }
} finally {
  await observation.stop();
}
const finishedAt = new Date().toISOString();
const drain = await drainLoad(resources, 300000);
const finalIntegrity = { passed: false, expectedRecords: 5000 + created.length };
try {
  finalIntegrity.snapshot = await loadIntegrity(resources);
  verifyFinishedSnapshot(finalIntegrity.snapshot, finalIntegrity.expectedRecords);
  finalIntegrity.created = await verifyCreatedTasks(created, clients, externalOrigin, true);
  finalIntegrity.passed =
    drain.drained &&
    finalIntegrity.created.completed === created.length &&
    finalIntegrity.created.pending === 0 &&
    Object.keys(finalIntegrity.created.errors).length === 0;
} catch (error) {
  finalIntegrity.error = error instanceof ApiFailure ? error.code : error.name;
}
const report = {
  profile: 'steady',
  sourceCommit,
  startedAt,
  finishedAt,
  operation: 'create-only open-loop; not the mixed NF08 API profile',
  rates,
  phaseSeconds,
  maxInFlight,
  phases,
  plannedArrivalSeconds: rates.length * phaseSeconds,
  resources,
  drain,
  finalIntegrity,
  pipeline: await pipelineSummary(resources, startedAt),
  generator: {
    cpuMicros: process.cpuUsage(cpuBefore),
    rssAfterBytes: process.memoryUsage().rss,
    scope:
      'Firebat Node process outside container budget, including observation and verification; excludes child processes',
  },
  observation: { samples: observation.samples, errors: observation.errors },
  sourceUnchanged: git('rev-parse', 'HEAD') === sourceCommit && !git('status', '--porcelain'),
};
report.passed =
  report.sourceUnchanged &&
  phases.length === rates.length &&
  phases.every((phase) => phase.passed) &&
  observation.errors.length === 0 &&
  observation.samples.every((sample) =>
    sample.containers.every((item) => item.running && !item.oom && !item.restarted),
  ) &&
  finalIntegrity.passed;
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL('../results/steady.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.passed,
    sourceCommit,
    created: created.length,
    plannedArrivalSeconds: report.plannedArrivalSeconds,
    finalIntegrity: finalIntegrity.passed,
  }),
);
if (!report.passed) process.exitCode = 1;
