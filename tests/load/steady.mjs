import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ApiSession, ApiFailure, localOrigin } from '../support/http.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { observeLoad, loadSnapshot, drainLoad, loadIntegrity, pipelineSummary } from './metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';
import { runSteadyArrivals } from './steady-workload.mjs';
import { assessSteadyPhase } from './steady-assessment.mjs';

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
  phaseSeconds < 1
)
  throw new Error('Set positive integer SI_STEADY_RATES and SI_STEADY_PHASE_SECONDS');
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
const phaseMetrics = rates.map(() => ({ latencies: [], errors: {}, successes: 0 }));
let serial = 0;
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
let arrivals;
try {
  console.log('Continuous steady schedule: ' + rates.join('/') + ' creates/s, ' + phaseSeconds + 's per phase');
  arrivals = await runSteadyArrivals({
    phases: rates.map((rate) => ({ rate, durationMs: phaseSeconds * 1000 })),
    maxInFlight,
    shouldStop: safetyStop,
    perform: async (_index, phaseIndex) => {
      const metrics = phaseMetrics[phaseIndex];
      const sequence = serial++,
        client = clients[sequence % clients.length];
      const input = { title: 'Steady ' + sequence, quantity: 25 };
      const beforeRequest = performance.now();
      try {
        const task = await client.session.command('POST', '/api/tasks', input);
        if (typeof task?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
        created.push({
          taskId: task.taskId,
          client: client.index,
          ownerId: client.userId,
          title: input.title,
        });
        metrics.successes++;
      } catch (error) {
        const code =
          error instanceof ApiFailure
            ? error.status + ':' + error.code
            : error instanceof Error
              ? error.name
              : 'UnknownFailure';
        metrics.errors[code] = (metrics.errors[code] || 0) + 1;
      } finally {
        metrics.latencies.push(performance.now() - beforeRequest);
      }
    },
  });
} finally {
  await observation.stop();
}
const finishedAt = arrivals.finishedAt;
const nearestObservation = (at) =>
  observation.samples.reduce((nearest, sample) =>
    Math.abs(Date.parse(sample.at) - Date.parse(at)) < Math.abs(Date.parse(nearest.at) - Date.parse(at))
      ? sample
      : nearest,
  );
for (const [index, phase] of arrivals.phases.entries()) {
  const metrics = phaseMetrics[index],
    before = nearestObservation(phase.startedAt),
    after = nearestObservation(phase.finishedAt);
  phases.push({
    targetCreatesPerSecond: rates[index],
    plannedSeconds: phaseSeconds,
    startedAt: phase.startedAt,
    finishedAt: phase.finishedAt,
    arrivals: { ...phase, startDelaysMs: undefined, startDelayP95Ms: p95(phase.startDelaysMs) },
    successes: metrics.successes,
    errors: metrics.errors,
    createP95Ms: p95(metrics.latencies),
    before,
    after,
    observationOffsetsMs: {
      before: Date.parse(before.at) - Date.parse(phase.startedAt),
      after: Date.parse(after.at) - Date.parse(phase.finishedAt),
    },
    pendingGrowth: after.app.pending - before.app.pending,
    passed:
      !phase.stoppedFor &&
      phase.missed === 0 &&
      phase.notOffered === 0 &&
      phase.started === phase.planned &&
      metrics.successes === phase.planned &&
      p95(metrics.latencies) <= 3000,
  });
}
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
for (const phase of phases) phase.sustainability = assessSteadyPhase(phase, observation.queue.samples);
const report = {
  profile: 'steady',
  sourceCommit,
  startedAt,
  finishedAt,
  operation: 'create-only open-loop; not the mixed NF08 API profile',
  rates,
  phaseSeconds,
  maxInFlight,
  arrivalSchedule: {
    plannedDurationMs: arrivals.plannedDurationMs,
    elapsedIncludingTailMs: arrivals.elapsedIncludingTailMs,
    peakInFlight: arrivals.peakInFlight,
    stoppedFor: arrivals.stoppedFor,
  },
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
      'Server-side Node process outside container budget, including observation and verification; excludes child processes',
  },
  observation: { samples: observation.samples, errors: observation.errors, queue: observation.queue },
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
report.sustainable = report.passed && phases.every((phase) => phase.sustainability.passed);
await mkdir(new URL('../results/', import.meta.url), { recursive: true });
await writeFile(new URL('../results/steady.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    passed: report.passed,
    sustainable: report.sustainable,
    sourceCommit,
    created: created.length,
    plannedArrivalSeconds: report.plannedArrivalSeconds,
    finalIntegrity: finalIntegrity.passed,
  }),
);
if (!report.passed) process.exitCode = 1;
