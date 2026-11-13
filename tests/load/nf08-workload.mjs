import { performance } from 'node:perf_hooks';
import { hostname, cpus, freemem, totalmem } from 'node:os';
import { ApiSession, ApiFailure, parallel } from '../support/http.mjs';

export async function prepareNf08Clients(dataset, origin, password) {
  await Promise.all(dataset.accounts.map(async account => {
    const session = new ApiSession(origin); await session.login(account.username, password);
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
    const identity = await session.login(dataset.accounts[owner].username, password);
    const task = await session.get('/api/tasks/' + dataset.accounts[owner].tasks[Math.floor(index / 2)]);
    clients[index] = { index, session, userId: identity.userId, task, action: index % 4, counter: 0 };
  });
  return clients;
}

export async function runNf08Workload(clients, { warmupMs = 30_000, measureMs = 120_000 } = {}) {
  if (!Number.isFinite(warmupMs) || warmupMs < 0 || !Number.isFinite(measureMs) || measureMs <= 0)
    throw new Error('The workload requires finite nonnegative warmup and positive measurement times');
  const cpuBefore = process.cpuUsage(), rssBefore = process.memoryUsage().rss, monotonicStart = performance.now();
  const hostCpuBefore = cpus(), hostFreeBefore = freemem();

  const measurements = ['list', 'card', 'create', 'rename'].map(operation => ({ operation, latencies: [], successes: 0, errors: {} }));
  const created = [], allCreated = [];
  const warmupErrors = {};
  let serial = 200000;
  const startedAt = new Date().toISOString();
  const warmEnd = performance.now() + warmupMs;
  const measureEnd = warmEnd + measureMs;
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
  const hostCpuAfter = cpus();
  const sumCpu = samples => samples.reduce((result, cpu) => ({
    total: result.total + Object.values(cpu.times).reduce((sum, value) => sum + value, 0),
    idle: result.idle + cpu.times.idle,
  }), { total: 0, idle: 0 });
  const first = sumCpu(hostCpuBefore), last = sumCpu(hostCpuAfter);
  const hostTotalDelta = last.total - first.total;
  const hostCpuStable = hostCpuAfter.length === hostCpuBefore.length && hostTotalDelta > 0;
  return { startedAt, finishedAt, measurements, created, allCreated, warmupErrors,
    warmupSeconds: warmupMs / 1000, measuredSeconds: measureMs / 1000,
    generator: { host: hostname(), platform: process.platform, nodeVersion: process.version,
      pid: process.pid, cpuMicros: process.cpuUsage(cpuBefore), durationMs: performance.now() - monotonicStart,
      rssBeforeBytes: rssBefore, rssAfterBytes: process.memoryUsage().rss,
      hostResources: { logicalCpus: hostCpuBefore.length, totalMemoryBytes: totalmem(),
        freeMemoryBeforeBytes: hostFreeBefore, freeMemoryAfterBytes: freemem(),
        cpuTopologyStable: hostCpuStable,
        meanCpuBusyFraction: hostCpuStable ? 1 - (last.idle - first.idle) / hostTotalDelta : null,
        scope: 'Whole host, including SSH children and other applications; mean, not a peak' },
      scope: 'Node process only; excludes SSH children and server containers; RSS is two snapshots, not a peak' } };
}

export function validateNf08Workload(workload) {
  const reject = () => { throw new Error('Incomplete or malformed NF08 workload report'); };
  if (!workload || workload.warmupSeconds !== 30 || workload.measuredSeconds !== 120 ||
      !Number.isFinite(workload.generator?.durationMs) || workload.generator.durationMs < 150000 ||
      !Array.isArray(workload.measurements) || workload.measurements.length !== 4 ||
      !Array.isArray(workload.created) || !Array.isArray(workload.allCreated) ||
      !workload.warmupErrors || typeof workload.warmupErrors !== 'object' || Array.isArray(workload.warmupErrors)) reject();
  if (Object.values(workload.warmupErrors).some(value => !Number.isInteger(value) || value < 0)) reject();
  for (const [index, stat] of workload.measurements.entries()) {
    if (stat.operation !== ['list', 'card', 'create', 'rename'][index] ||
        !Array.isArray(stat.latencies) || stat.latencies.some(value => !Number.isFinite(value) || value < 0) ||
        !Number.isInteger(stat.successes) || stat.successes < 0 || !stat.errors || typeof stat.errors !== 'object' || Array.isArray(stat.errors))
      reject();
    const errors = Object.values(stat.errors);
    if (errors.some(value => !Number.isInteger(value) || value < 0) ||
        stat.successes + errors.reduce((sum, value) => sum + value, 0) !== stat.latencies.length) reject();
  }
}
