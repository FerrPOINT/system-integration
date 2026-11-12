import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const appSql = [
  "SELECT json_build_object(",
  "'records',(SELECT count(*) FROM tasks),",
  "'pending',(SELECT count(*) FROM tasks WHERE business_status NOT IN ('SUCCEEDED','REJECTED')),",
  "'oldestPendingSeconds',coalesce((SELECT extract(epoch FROM clock_timestamp()-min(created_at)) FROM tasks WHERE business_status NOT IN ('SUCCEEDED','REJECTED')),0),",
  "'queued',(SELECT count(*) FROM delivery_queue),",
  "'activeClaims',(SELECT count(*) FROM delivery_queue WHERE claimed_until > statement_timestamp()),",
  "'waits',(SELECT coalesce(json_agg(w),'[]'::json) FROM (SELECT datname,wait_event_type,count(*) FROM pg_stat_activity WHERE datname IN ('si_test','si_emulator_test') AND pid<>pg_backend_pid() AND state='active' GROUP BY datname,wait_event_type) w),",
  "'database',(SELECT json_agg(d) FROM (SELECT datname,xact_commit,xact_rollback,blks_hit,blks_read,deadlocks,temp_bytes FROM pg_stat_database WHERE datname IN ('si_test','si_emulator_test')) d),",
  "'settings',(SELECT json_object_agg(name,json_build_object('value',setting,'unit',unit)) FROM pg_settings WHERE name IN ('shared_buffers','effective_cache_size','work_mem','max_connections')));",
].join('\n');
const emulatorSql = [
  "SELECT json_build_object(",
  "'accepted',(SELECT count(*) FROM operations),",
  "'executed',(SELECT count(*) FROM operations WHERE executions=1),",
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
  return { at, app, emulator, containers, usage: stats.stdout.trim().split('\n').map(line => {
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
