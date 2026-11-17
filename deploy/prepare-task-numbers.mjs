import { execFileSync } from 'node:child_process';

const [target, option, extra] = process.argv.slice(2);
if (!['load', 'demo'].includes(target) || (option && option !== '--stage') || extra)
  throw new Error('Usage: node deploy/prepare-task-numbers.mjs load|demo [--stage]');

const project = target === 'load' ? 'system-integration-load' : 'system-integration';
const app = target === 'load' ? 'si_test' : 'si_app';
const emulator = target === 'load' ? 'si_emulator_test' : 'si_emulator';
function running(service) {
  return execFileSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      'label=com.docker.compose.project=' + project,
      '--filter',
      'label=com.docker.compose.service=' + service,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

for (const service of ['backend', 'emulator'])
  if (running(service).length) throw new Error('Stop backend and emulator in the selected installation first');
const postgres = running('postgres');
if (postgres.length !== 1) throw new Error('Expected one running PostgreSQL container in ' + project);
const container = postgres[0];
if (
  execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', container], { encoding: 'utf8' }).trim() !==
  'healthy'
)
  throw new Error('PostgreSQL must be healthy');

function sql(database, input) {
  return execFileSync(
    'docker',
    ['exec', '-i', container, 'psql', '-wXqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'si_admin', '-d', database],
    { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).trim();
}
const read = (database, input) => JSON.parse(sql(database, 'BEGIN READ ONLY;\n' + input + '\nCOMMIT;'));
const version = (database) =>
  read(database, 'SELECT to_jsonb(max(version::int)) FROM flyway_schema_history WHERE success;');
if (version(app) !== 13 || version(emulator) !== 2)
  throw new Error('Expected Flyway versions 13 and 2 before preparing the task-number migration');

const { cursor, tasks } = read(
  app,
  'SELECT jsonb_build_object(' +
    "'cursor',(SELECT last_cursor FROM incoming_position), 'tasks', coalesce(jsonb_agg(jsonb_build_object(" +
    "'id',operation_id,'reference',request_reference,'quantity',request_quantity,'delivery',delivery_status)), '[]')) FROM tasks;",
);
if (!Number.isSafeInteger(cursor)) throw new Error('Invalid stored cursor');
const operations = read(
  emulator,
  "SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'reference',reference," +
    "'quantity',quantity)), '[]') FROM operations;",
);
const unpublished = read(
  emulator,
  "SELECT coalesce(jsonb_agg(jsonb_build_object('id',operation_id," +
    "'reference',payload #>> '{request,reference}', 'quantity',(payload #>> '{request,quantity}')::int)), '[]') " +
    'FROM result_events WHERE cursor > ' +
    cursor +
    ' OR (cursor IS NULL AND publish_after IS NOT NULL);',
);
const byId = new Map(tasks.map((task) => [task.id, task]));
for (const external of [...operations, ...unpublished]) {
  const task = byId.get(external.id);
  if (
    task &&
    !['STOPPED', 'NEEDS_REVIEW'].includes(task.delivery) &&
    task.quantity === external.quantity &&
    task.reference !== external.reference
  )
    throw new Error('Active reference-only conflict requires review before migration: ' + external.id);
}
const accepted = new Set(operations.map((operation) => operation.id));
const pendingFaults = read(
  emulator,
  "SELECT coalesce(jsonb_agg(reference ORDER BY reference),'[]') FROM faults WHERE bound_operation_id IS NULL;",
);
const mappings = pendingFaults.map((reference) => {
  const matches = tasks.filter((task) => task.reference === reference && !accepted.has(task.id));
  if (matches.length !== 1) throw new Error('Pending fault must identify exactly one unsent operation: ' + reference);
  return { reference, operation_id: matches[0].id };
});
if (option === '--stage' && mappings.length) {
  const data = "'" + JSON.stringify(mappings).replaceAll("'", "''") + "'::jsonb";
  sql(
    emulator,
    'BEGIN;\nSET LOCAL ROLE ' +
      emulator +
      ';\n' +
      'CREATE TABLE IF NOT EXISTS task_number_fault_mapping (reference text PRIMARY KEY, operation_id uuid NOT NULL UNIQUE);\n' +
      'INSERT INTO task_number_fault_mapping SELECT r.reference, r.operation_id FROM jsonb_to_recordset(' +
      data +
      ') AS r(reference text, operation_id uuid) ON CONFLICT (reference) DO NOTHING;\n' +
      'DO $$ BEGIN IF EXISTS (' +
      'SELECT * FROM task_number_fault_mapping EXCEPT SELECT * FROM jsonb_to_recordset(' +
      data +
      ") AS r(reference text, operation_id uuid)) THEN RAISE EXCEPTION 'Staged fault mapping differs from the frozen installation'; END IF; END $$;\n" +
      'COMMIT;',
  );
}
console.log(
  JSON.stringify({
    project,
    tasks: tasks.length,
    operations: operations.length,
    cursor,
    pendingFaults: mappings.length,
    staged: option === '--stage',
  }),
);
