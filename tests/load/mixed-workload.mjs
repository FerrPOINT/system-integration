import { performance } from 'node:perf_hooks';
import { ApiFailure } from '../support/http.mjs';

// A fixed cycle owns one create/rename and optional reads. No phase waits for
// responses from an earlier phase; runSteadyArrivals owns the sole pacing clock.

// Warmup uses the same operations at a gentler fixed rate; measured arrivals do
// not change. Keeping all phases on one schedule avoids response-tail barriers.
export function mixedSchedule(env = {}) {
  const rate = Number(env.SI_MIXED_RATE || 90);
  const warmRate = Number(env.SI_MIXED_WARMUP_RATE || Math.min(rate, 30));
  const seconds = Number(env.SI_MIXED_PHASE_SECONDS || 60);
  const warmSeconds = Number(env.SI_MIXED_WARMUP_SECONDS || 30);
  const flags = (env.SI_MIXED_READS || '0,1,0').split(',');
  if (
    !Number.isInteger(rate) ||
    rate < 1 ||
    rate > 100 ||
    !Number.isInteger(warmRate) ||
    warmRate < 1 ||
    warmRate > rate ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    !Number.isInteger(warmSeconds) ||
    warmSeconds < 1 ||
    !flags.length ||
    flags.some((flag) => !['0', '1'].includes(flag))
  )
    throw new Error('Invalid mixed schedule: rate 1..100, warm rate 1..rate, positive durations, reads 0/1');
  return [
    { rate: warmRate, durationMs: warmSeconds * 1000, reads: true },
    ...flags.map((flag) => ({ rate, durationMs: seconds * 1000, reads: flag === '1' })),
  ];
}

export function mixedWorkload(clients, accounts, readsByPhase) {
  if (!clients.length || accounts.length !== 2 || accounts.some((a) => !a.tasks.length))
    throw new Error('Mixed workload requires two prepared owners and their tasks');
  const targets = accounts.map((account) =>
    account.tasks.slice(0, 500).map((taskId) => ({ taskId, revision: 1, busy: false })),
  );
  const operations = () =>
    Object.fromEntries(
      ['create', 'rename', 'list', 'card'].map((key) => [key, { latencies: [], successes: 0, errors: {} }]),
    );
  const metrics = readsByPhase.map(operations);
  const created = [];
  let activeHttp = 0,
    peakHttp = 0;

  async function track(metric, action) {
    const started = performance.now();
    activeHttp++;
    peakHttp = Math.max(peakHttp, activeHttp);
    try {
      await action();
      metric.successes++;
    } catch (error) {
      const code = error instanceof ApiFailure ? error.status + ':' + error.code : error.name;
      metric.errors[code] = (metric.errors[code] || 0) + 1;
    } finally {
      activeHttp--;
      metric.latencies.push(performance.now() - started);
    }
  }

  async function perform(index, phase) {
    const clientIndex = index % clients.length,
      client = clients[clientIndex];
    const owner = clientIndex % 2;
    const target = targets[owner][Math.floor(index / 2) % targets[owner].length];
    if (target.busy) throw new Error('Generator reused an unfinished rename target');
    target.busy = true;
    const work = [
      track(metrics[phase].create, async () => {
        const input = {
          title: 'Mixed create ' + index,
          quantity: 25,
        };
        const result = await client.session.command('POST', '/api/tasks', input);
        if (typeof result?.taskId !== 'string') throw new ApiFailure(201, 'INVALID_CREATE_RESULT');
        created.push({
          taskId: result.taskId,
          client: clientIndex,
          ownerId: client.userId,
          title: input.title,
          phase,
        });
      }),
      track(metrics[phase].rename, async () => {
        try {
          const title = 'Mixed rename ' + index;
          const result = await client.session.command('PATCH', '/api/tasks/' + target.taskId, {
            title,
            expectedTitleRevision: target.revision,
          });
          if (result?.title !== title || result.titleRevision !== target.revision + 1)
            throw new ApiFailure(200, 'INVALID_RENAME_RESULT');
          target.revision = result.titleRevision;
          target.title = title;
          target.client = clientIndex;
        } finally {
          target.busy = false;
        }
      }),
    ];
    if (readsByPhase[phase]) {
      work.push(
        track(metrics[phase].list, async () => {
          const result = await client.session.get('/api/tasks?businessStatus=SUCCEEDED&page=0');
          if (
            result.items?.length !== 20 ||
            !Number.isSafeInteger(result.totalItems) ||
            result.totalItems < 2500 ||
            result.totalPages !== Math.ceil(result.totalItems / 20) ||
            result.items.some((task) => task.ownerId !== client.userId || task.businessStatus !== 'SUCCEEDED')
          )
            throw new ApiFailure(200, 'INVALID_LIST_PAGE');
        }),
        track(metrics[phase].card, async () => {
          const result = await client.session.get('/api/tasks/' + client.task.taskId);
          if (
            result.taskId !== client.task.taskId ||
            result.ownerId !== client.userId ||
            !Number.isSafeInteger(result.titleRevision) ||
            result.titleRevision < 1
          )
            throw new ApiFailure(200, 'INVALID_TASK_STATE');
        }),
      );
    }
    await Promise.all(work);
  }
  return { perform, metrics, created, targets, peakHttp: () => peakHttp };
}
