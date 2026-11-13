import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hostname, freemem, totalmem, loadavg } from 'node:os';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const appSql = [
  "SELECT json_build_object(",
  "'records',(SELECT count(*) FROM tasks),",
  "'pending',(SELECT count(*) FROM tasks WHERE business_status NOT IN ('SUCCEEDED','REJECTED')),",
  "'oldestPendingSeconds',coalesce((SELECT extract(epoch FROM clock_timestamp()-min(created_at)) FROM tasks WHERE business_status NOT IN ('SUCCEEDED','REJECTED')),0),",
  "'queued',(SELECT count(*) FROM delivery_queue),",
  "'oldestQueuedSeconds',coalesce((SELECT extract(epoch FROM clock_timestamp()-min(t.created_at)) FROM delivery_queue q JOIN tasks t ON t.operation_id=q.operation_id),0),",
  "'lastCursor',(SELECT last_cursor FROM incoming_position WHERE id=1),",
  "'activeClaims',(SELECT count(*) FROM delivery_queue WHERE claimed_until > statement_timestamp()),",
  "'waits',(SELECT coalesce(json_agg(w),'[]'::json) FROM (SELECT datname,wait_event_type,count(*) FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test') AND pid<>pg_backend_pid() AND state='active' GROUP BY datname,wait_event_type) w),",
  "'blocked',(SELECT coalesce(json_agg(b),'[]'::json) FROM (SELECT pid,datname,query,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,extract(epoch FROM clock_timestamp()-xact_start) AS transaction_age_seconds FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test') AND pid<>pg_backend_pid() AND cardinality(pg_blocking_pids(pid))>0) b),",
  "'activeQueries',(SELECT coalesce(json_agg(q),'[]'::json) FROM (SELECT datname,query,wait_event_type,wait_event,count(*) AS sessions,max(extract(epoch FROM clock_timestamp()-query_start)) AS oldest_query_seconds FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test') AND pid<>pg_backend_pid() AND state='active' GROUP BY datname,query,wait_event_type,wait_event) q),",
  "'transactions',(SELECT json_build_object('active',count(*) FILTER (WHERE state='active'),'idleInTransaction',count(*) FILTER (WHERE state='idle in transaction'),'oldestSeconds',coalesce(max(extract(epoch FROM clock_timestamp()-xact_start)),0)) FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test') AND pid<>pg_backend_pid() AND xact_start IS NOT NULL),",
  "'database',(SELECT json_agg(d) FROM (SELECT datname,xact_commit,xact_rollback,blks_hit,blks_read,deadlocks,temp_bytes FROM pg_stat_database WHERE datname IN ('si_test','si_emulator_test')) d),",
  "'settings',(SELECT json_object_agg(name,json_build_object('value',setting,'unit',unit)) FROM pg_settings WHERE name IN ('shared_buffers','effective_cache_size','work_mem','max_connections','track_activity_query_size')));",
].join('\n');
const emulatorSql = [
  "SELECT json_build_object(",
  "'accepted',(SELECT count(*) FROM operations),",
  "'executed',(SELECT count(*) FROM operations WHERE executions=1),",
  "'awaitingExecution',(SELECT count(*) FROM operations WHERE executions=0),",
  "'oldestUnexecutedSeconds',coalesce((SELECT extract(epoch FROM clock_timestamp()-min(accepted_at)) FROM operations WHERE executions=0),0),",
  "'lastCursor',(SELECT last_cursor FROM feed_position WHERE id=1),",
  "'duplicateExecutions',(SELECT count(*) FROM operations WHERE executions>1),",
  "'unpublished',(SELECT count(*) FROM result_events WHERE cursor IS NULL));",
].join('\n');

async function sql(containerId, database, query) {
  const result = await execute('docker', ['exec', containerId, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'si_admin', '-d', database, '-c', 'BEGIN READ ONLY;' + query + 'COMMIT;'],
    { cwd: root, timeout: 15000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout.trim());
}

export async function loadSnapshot(resources) {
  const postgres = resources.find(item => item.service === 'postgres');
  const ids = resources.map(item => item.containerId);
  const at = new Date().toISOString();
  const [app, emulator, stats, states] = await Promise.all([
    sql(postgres.containerId, 'si_test', appSql), sql(postgres.containerId, 'si_emulator_test', emulatorSql),
    execute('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...ids], { timeout: 15000 }),
    execute('docker', ['inspect', '--format', '{{json .State}}', ...ids], { timeout: 15000 }),
  ]);
  const containers = states.stdout.trim().split('\n').map((line, index) => {
    const state = JSON.parse(line);
    return { service: resources[index].service, running: state.Running, oom: state.OOMKilled,
      restarted: state.StartedAt !== resources[index].startedAt };
  });
  return { at, app, emulator, containers,
    runnerProcess: { host: hostname(), pid: process.pid, cpuMicros: process.cpuUsage(),
      rssBytes: process.memoryUsage().rss, uptimeSeconds: process.uptime() },
    host: { totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), loadAverage: loadavg() },
    usage: stats.stdout.trim().split('\n').map(line => {
    const item = JSON.parse(line);
    return { name: item.Name, cpu: item.CPUPerc, memory: item.MemUsage, memoryPercent: item.MemPerc };
  }) };
}

export async function observeLoad(resources) {
  const samples = [], errors = [];
  const collect = async () => { samples.push(await loadSnapshot(resources)); };
  await collect();
  let pending;
  const timer = setInterval(() => {
    if (pending) return;
    pending = collect().catch(error => errors.push(error.code || error.name)).finally(() => { pending = undefined; });
  }, 5000);
  return { samples, errors, async stop() {
    clearInterval(timer);
    await pending;
    try { await collect(); } catch (error) { errors.push(error.code || error.name); }
  } };
}


// Detailed aggregation runs after measurement, so it does not add work to the timed profile.
export async function pipelineSummary(resources, since) {
  if (new Date(since).toISOString() !== since) throw new Error('Expected an ISO measurement start');
  const postgres = resources.find(item => item.service === 'postgres').containerId;
  const [app, emulator] = await Promise.all([
    sql(postgres, 'si_test', `
      SELECT json_build_object(
        'firstAttemptDelayP95Ms',(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM a.started_at-t.created_at)*1000)
          FROM tasks t JOIN delivery_attempts a ON a.operation_id=t.operation_id AND a.number=1
          WHERE t.created_at >= '${since}'::timestamptz),
        'attemptDurationP95Ms',(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at-started_at)*1000)
          FROM delivery_attempts WHERE started_at >= '${since}'::timestamptz AND finished_at IS NOT NULL),
        'resultApplyDelayP95Ms',(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM h.occurred_at-(t.accepted_result->>'completedAt')::timestamptz)*1000)
          FROM tasks t JOIN task_history h ON h.task_id=t.id AND h.event_type='RESULT_APPLIED' AND h.details->>'resultVersion'='2'
          WHERE t.created_at >= '${since}'::timestamptz),
        'attemptsByOutcome',(SELECT coalesce(json_object_agg(outcome,n),'{}'::json) FROM
          (SELECT coalesce(outcome,'IN_FLIGHT') outcome,count(*) n FROM delivery_attempts
           WHERE started_at >= '${since}'::timestamptz GROUP BY outcome) counts));
    `),
    sql(postgres, 'si_emulator_test', `
      SELECT json_build_object(
        'accepted',count(*),'executed',count(*) FILTER (WHERE executions=1),
        'executionDelayP95Ms',percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at-accepted_at)*1000)
      ) FROM operations WHERE accepted_at >= '${since}'::timestamptz;
    `),
  ]);
  return { since, measuredAt: new Date().toISOString(), app, emulator };
}


export async function drainLoad(resources, timeoutMs = 300000) {
  const startedAt = new Date().toISOString(), deadline = Date.now() + timeoutMs, samples = [];
  let stoppedFor = null, drained = false;
  do {
    const sample = await loadSnapshot(resources); samples.push(sample);
    if (sample.containers.some(item => !item.running || item.oom || item.restarted)) { stoppedFor = 'container-failure'; break; }
    drained = sample.app.pending === 0 && sample.app.queued === 0 && sample.emulator.awaitingExecution === 0 &&
      sample.emulator.unpublished === 0 && sample.app.lastCursor === sample.emulator.lastCursor;
    if (drained) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  } while (Date.now() < deadline);
  return { startedAt, finishedAt: new Date().toISOString(), drained, stoppedFor: stoppedFor || (drained ? null : 'drain-time-limit'), samples };
}

// Compare complete JSONB snapshots: JDBC timestamps and PostgreSQL text casts round half-microseconds differently.
export async function loadIntegrity(resources) {
  const postgres = resources.find(item => item.service === 'postgres').containerId;
  const [app, emulator] = await Promise.all([
    sql(postgres, 'si_test', `
      SELECT json_build_object(
        'records',count(*),'pending',count(*) FILTER (WHERE business_status NOT IN ('SUCCEEDED','REJECTED')),
        'badLocalState',count(*) FILTER (WHERE delivery_status IS DISTINCT FROM 'ACKNOWLEDGED'
          OR business_status IS DISTINCT FROM accepted_result->>'status'
          OR accepted_result->>'version' IS DISTINCT FROM '2'),
        'queued',(SELECT count(*) FROM delivery_queue),'openIssues',(SELECT count(*) FROM exchange_issues WHERE status='OPEN'),
        'badCreationHistory',(SELECT count(*) FROM tasks t WHERE (SELECT count(*) FROM task_history h WHERE h.task_id=t.id AND h.event_type='CREATED')<>1
          OR EXISTS (SELECT 1 FROM task_history h WHERE h.task_id=t.id AND h.event_type='CREATED' AND (h.actor<>'USER' OR h.actor_user_id IS DISTINCT FROM t.owner_id))),
        'badTerminalHistory',(SELECT count(*) FROM tasks t WHERE (SELECT count(*) FROM task_history h WHERE h.task_id=t.id AND h.event_type='RESULT_APPLIED' AND h.details->>'resultVersion'='2')<>1
          OR EXISTS (SELECT 1 FROM task_history h WHERE h.task_id=t.id AND h.event_type='RESULT_APPLIED' AND h.details->>'resultVersion'='2' AND h.actor<>'SYSTEM')),
        'badRenameHistory',(SELECT count(*) FROM tasks t WHERE t.title_revision-1 <>
          (SELECT count(*) FROM task_history h WHERE h.task_id=t.id AND h.event_type='RENAMED')
          OR EXISTS (SELECT 1 FROM task_history h WHERE h.task_id=t.id AND h.event_type='RENAMED'
            AND (h.actor<>'USER' OR h.actor_user_id IS DISTINCT FROM t.owner_id))),
        'lastCursor',(SELECT last_cursor FROM incoming_position WHERE id=1),
        'ids',md5(string_agg(operation_id::text,',' ORDER BY operation_id)),
        'requests',md5(string_agg(concat_ws('|',operation_id,request_reference,request_quantity),',' ORDER BY operation_id)),
        'results',md5(string_agg(concat_ws('|',operation_id,accepted_result::text),',' ORDER BY operation_id))
      ) FROM tasks;
    `),
    sql(postgres, 'si_emulator_test', `
      SELECT json_build_object(
        'accepted',count(*),'executed',count(*) FILTER (WHERE executions=1),'duplicateExecutions',count(*) FILTER (WHERE executions>1),
        'unpublished',(SELECT count(*) FROM result_events WHERE cursor IS NULL),'lastCursor',(SELECT last_cursor FROM feed_position WHERE id=1),
        'ids',md5(string_agg(id::text,',' ORDER BY id)),
        'requests',md5(string_agg(concat_ws('|',id,reference,quantity),',' ORDER BY id)),
        'results',md5(string_agg(concat_ws('|',id,result::text),',' ORDER BY id))
      ) FROM operations;
    `),
  ]);
  return { app, emulator };
}
