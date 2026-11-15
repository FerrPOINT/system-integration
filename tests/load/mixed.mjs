import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { ApiFailure, localOrigin, parallel } from '../support/http.mjs';
import { prepareNf08Clients } from './nf08-workload.mjs';
import { mixedWorkload, mixedSchedule } from './mixed-workload.mjs';
import { runSteadyArrivals } from './steady-workload.mjs';
import { assessSteadyPhase } from './steady-assessment.mjs';
import { qualifiedLoadEnvironment } from './environment.mjs';
import { observeLoad, drainLoad, loadIntegrity, pipelineSummary } from './metrics.mjs';
import { verifyCreatedTasks, verifyFinishedSnapshot } from './integrity.mjs';

const git = (...args) => execFileSync('git', args, { cwd: new URL('../..', import.meta.url), encoding: 'utf8' }).trim();
const generatorCommit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain')) throw new Error('Commit the mixed-load generator first');
// Explicit immutable application selection allows the SAME generator to compare
// baseline and candidate images. This is not a fallback to an older application.
const sourceCommit = process.env.SI_MIXED_APP_COMMIT || generatorCommit;
if (!/^[a-f0-9]{40}$/.test(sourceCommit) || git('rev-parse', sourceCommit + '^{commit}') !== sourceCommit)
  throw new Error('SI_MIXED_APP_COMMIT must identify an existing immutable commit');
const schedule = mixedSchedule(process.env);
const reads = schedule.map((phase) => phase.reads);
const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
const resources = qualifiedLoadEnvironment(sourceCommit);
const dataset = JSON.parse(await readFile(new URL('../results/load-dataset.json', import.meta.url), 'utf8'));
if (dataset.origin !== origin || dataset.profile !== 'mixed' || dataset.initialCount !== 5000)
  throw new Error('Prepare exactly 5000 completed mixed-profile initial records');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
const clients = await prepareNf08Clients(dataset, origin, process.env.SI_DEMO_PASSWORD);
const workload = mixedWorkload(clients, dataset.accounts, reads);
const p95 = (values) => (values.length ? values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null);
const observation = await observeLoad(resources);
const cpuBefore = process.cpuUsage();
let arrival;
try {
  arrival = await runSteadyArrivals({
    phases: schedule,
    maxInFlight: 64,
    perform: workload.perform,
    shouldStop: () =>
      observation.errors.length
        ? 'observation-error'
        : observation.samples.at(-1).containers.some((c) => !c.running || c.oom || c.restarted)
          ? 'container-failure'
          : null,
  });
} finally {
  await observation.stop();
}
const phases = arrival.phases.map((phase, index) => {
  const operations = Object.fromEntries(
    Object.entries(workload.metrics[index]).map(([name, metric]) => [
      name,
      { successes: metric.successes, errors: metric.errors, p95Ms: p95(metric.latencies) },
    ]),
  );
  const passed =
    !phase.stoppedFor &&
    phase.missed === 0 &&
    phase.notOffered === 0 &&
    Object.entries(operations).every(([name, m]) => {
      const active = reads[index] || ['create', 'rename'].includes(name);
      return (
        m.successes === (active ? phase.planned : 0) &&
        !Object.keys(m.errors).length &&
        (index === 0 || !active || m.p95Ms <= (['list', 'card'].includes(name) ? 2000 : 3000))
      );
    });
  const result = {
    targetCreatesPerSecond: phase.rate,
    plannedSeconds: phase.plannedDurationMs / 1000,
    reads: reads[index],
    startedAt: phase.startedAt,
    finishedAt: phase.finishedAt,
    arrivals: { ...phase, startDelaysMs: undefined, startDelayP95Ms: p95(phase.startDelaysMs) },
    operations,
    passed,
  };
  if (index) result.sustainability = assessSteadyPhase(result, observation.samples);
  return result;
});
const drain = await drainLoad(resources, 300000);
const integrity = { passed: false, acceptedDataCorrect: false, expectedRecords: 5000 + workload.created.length };
try {
  integrity.snapshot = await loadIntegrity(resources);
  verifyFinishedSnapshot(integrity.snapshot, integrity.expectedRecords);
  for (const [index, phase] of phases.entries())
    phase.verified = await verifyCreatedTasks(
      workload.created.filter((task) => task.phase === index),
      clients,
      external,
      true,
    );
  const renameErrors = {};
  const renamed = workload.targets.flat().filter((target) => target.title !== undefined);
  await parallel(renamed, 4, async (target) => {
    try {
      const item = await clients[target.client].session.get('/api/tasks/' + target.taskId);
      if (
        item.title !== target.title ||
        item.titleRevision !== target.revision ||
        item.ownerId !== clients[target.client].userId
      )
        throw new ApiFailure(200, 'INVALID_RENAME_STATE');
    } catch (error) {
      const key = error instanceof ApiFailure ? error.status + ':' + error.code : error.name;
      renameErrors[key] = (renameErrors[key] || 0) + 1;
    }
  });
  integrity.renamed = { checked: renamed.length, errors: renameErrors };
  integrity.acceptedDataCorrect =
    drain.drained &&
    !Object.keys(renameErrors).length &&
    phases.every(
      (p) =>
        p.verified.completed === p.verified.checked &&
        !p.verified.pending &&
        !p.verified.notAccepted &&
        !Object.keys(p.verified.errors).length,
    );
  // Planned arrivals remain mandatory for capacity; correct admitted data cannot
  // turn an overloaded profile into a PASS.
  integrity.passed = integrity.acceptedDataCorrect && phases.every((p) => p.verified.completed === p.arrivals.planned);
} catch (error) {
  integrity.error = error instanceof ApiFailure ? error.code : error.name;
}
const resourcesAfter = qualifiedLoadEnvironment(sourceCommit);
const report = {
  profile: 'mixed',
  sourceCommit,
  generatorCommit,
  scope:
    'fixed create AND rename rate; optional list/card at the same rate; 64 in-flight cycles, up to 256 HTTP requests',
  startedAt: arrival.startedAt,
  finishedAt: arrival.finishedAt,
  initialRecords: 5000,
  warmup: phases[0],
  phases: phases.slice(1),
  arrivalSchedule: { ...arrival, phases: undefined },
  peakHttpInFlight: workload.peakHttp(),
  resources,
  resourcesAfter,
  finalIntegrity: integrity,
  drain,
  observation: { samples: observation.samples, errors: observation.errors },
  pipeline: await pipelineSummary(resources, arrival.startedAt),
  generator: {
    cpuMicros: process.cpuUsage(cpuBefore),
    rssBytes: process.memoryUsage().rss,
    scope: 'Firebat process outside container limit; includes verification',
  },
  sourceUnchanged: generatorCommit === git('rev-parse', 'HEAD') && !git('status', '--porcelain'),
};
report.passed =
  report.sourceUnchanged &&
  JSON.stringify(resources) === JSON.stringify(resourcesAfter) &&
  phases.every((p) => p.passed) &&
  integrity.passed &&
  !observation.errors.length &&
  observation.samples.every((s) => s.containers.every((c) => c.running && !c.oom && !c.restarted));
report.sustainable = report.passed && report.phases.every((p) => p.sustainability.passed);
await writeFile(new URL('../results/mixed.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      sustainable: report.sustainable,
      sourceCommit,
      generatorCommit,
      created: workload.created.length,
      integrity: integrity.passed,
      phases: report.phases.map((p) => ({
        reads: p.reads,
        createP95Ms: p.operations.create.p95Ms,
        executionP95Ms: p.verified?.p95Ms,
        sustainability: p.sustainability,
      })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
