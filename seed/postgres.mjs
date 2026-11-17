import { execFileSync } from 'node:child_process';
import { loadEnvironment } from '../tests/load/environment.mjs';

// Column types belong to the persisted schema; no runtime DDL or schema defaults are changed.
const tables = {
  tasks:
    'id uuid,owner_id uuid,operation_id uuid,title text,title_revision bigint,request_reference text,request_quantity integer,delivery_status text,business_status text,created_at timestamptz,exchange_version bigint,accepted_result jsonb',
  task_history:
    'id uuid,task_id uuid,operation_id uuid,occurred_at timestamptz,actor text,actor_user_id uuid,event_type text,summary text,details jsonb,observed_result jsonb,observation_fingerprint text',
  delivery_attempts:
    'id uuid,operation_id uuid,number integer,step text,started_at timestamptz,finished_at timestamptz,outcome text',
  delivery_queue:
    'operation_id uuid,next_step text,due_at timestamptz,attempts integer,automatic_attempts integer,claim_id uuid,claimed_until timestamptz',
  reconciliations: 'id uuid,task_id uuid,exchange_version bigint,checked_at timestamptz,checked_by uuid,snapshot jsonb',
  exchange_issues:
    'id uuid,task_id uuid,operation_id uuid,scope text,fingerprint text,issue_revision bigint,kind text,status text,opened_at timestamptz,summary text,evidence jsonb,assigned_to uuid,latest_reconciliation_id uuid,resolution jsonb',
  operations:
    'id uuid,reference text,quantity integer,accepted_at timestamptz,executions integer,result jsonb,completed_at timestamptz',
  result_events:
    'operation_id uuid,version integer,copy_number integer,payload jsonb,publish_after timestamptz,created_at timestamptz',
  faults: 'reference text,mode text,bound_operation_id uuid',
};

export const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export const json = (value) => literal(JSON.stringify(value)) + '::jsonb';

export function postgres() {
  const resources = loadEnvironment();
  const container = resources.find((resource) => resource.service === 'postgres').containerId;
  function query(database, sql) {
    if (!['si_test', 'si_emulator_test'].includes(database))
      throw new Error('Only isolated demo databases are supported');
    return execFileSync(
      'docker',
      ['exec', '-i', container, 'psql', '-w', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'si_admin', '-d', database],
      {
        input: `SET statement_timeout='30s'; SET lock_timeout='5s';\n${sql}`,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    ).trim();
  }
  const read = (database, sql) => JSON.parse(query(database, `BEGIN READ ONLY; ${sql} COMMIT;`));
  const version = read(
    'si_test',
    "SELECT coalesce(jsonb_agg(version),'[]') FROM flyway_schema_history WHERE success AND version='12';",
  );
  if (!version.includes('12')) throw new Error('Apply the current application migrations before seeding');
  return { query, read, resources };
}

export function insertion(table, rows) {
  const schema = tables[table];
  if (!schema) throw new Error('Unsupported seed table');
  if (!rows.length) return '';
  const columns = schema
    .split(',')
    .map((field) => field.split(' ')[0])
    .join(',');
  return `INSERT INTO ${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset(${json(rows)}) AS r(${schema});\n`;
}

export function insertDataset(db, model, existing) {
  const taskIds = new Set(existing.tasks.map((row) => row.id));
  const operationIds = new Set(existing.operations.map((row) => row.id));
  const issueIds = new Set(existing.issues.map((row) => row.id));
  const newTasks = model.rows.tasks.filter((row) => !taskIds.has(row.id));
  const ownedTasks = new Set(newTasks.map((row) => row.id));
  const ownedOperations = new Set(newTasks.map((row) => row.operation_id));
  const fresh = Object.fromEntries(
    Object.entries(model.rows).map(([table, rows]) => [
      table,
      rows.filter((row) => {
        if (table === 'tasks') return ownedTasks.has(row.id);
        if (table === 'operations') return ownedOperations.has(row.id) && !operationIds.has(row.id);
        if (table === 'result_events')
          return ownedOperations.has(row.operation_id) && !operationIds.has(row.operation_id);
        if (table === 'faults')
          return (
            !existing.faults.some((fault) => fault.reference === row.reference) &&
            (row.bound_operation_id
              ? ownedOperations.has(row.bound_operation_id)
              : newTasks.some((task) => task.request_reference === row.reference))
          );
        if (table === 'exchange_issues') return row.task_id ? ownedTasks.has(row.task_id) : !issueIds.has(row.id);
        return row.task_id ? ownedTasks.has(row.task_id) : ownedOperations.has(row.operation_id);
      }),
    ]),
  );
  // Each database commits atomically. A retry completes the second stage without rewriting the first.
  db.query(
    'si_emulator_test',
    `BEGIN; SELECT pg_advisory_xact_lock(60202601);\n${['operations', 'result_events', 'faults'].map((table) => insertion(table, fresh[table])).join('')}COMMIT;`,
  );
  db.query(
    'si_test',
    `BEGIN; SELECT pg_advisory_xact_lock(60202601);\n${['tasks', 'delivery_attempts', 'delivery_queue', 'task_history', 'reconciliations', 'exchange_issues'].map((table) => insertion(table, fresh[table])).join('')}COMMIT;`,
  );
  return { insertedTasks: newTasks.length, insertedIssues: fresh.exchange_issues.length };
}

export function existingDataset(db, model) {
  const ids = (rows) => rows.map((row) => literal(row.id)).join(',');
  const conflicts = db.read(
    'si_test',
    `SELECT to_jsonb(count(*)) FROM tasks WHERE request_reference IN (${model.rows.tasks.map((task) => literal(task.request_reference)).join(',')}) AND id NOT IN (${ids(model.rows.tasks)});`,
  );
  if (conflicts) throw new Error('Reserved demo references are already used by another dataset');
  const tasks = db.read(
    'si_test',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'owner',owner_id,'reference',request_reference,'quantity',request_quantity,'title',title)),'[]') FROM tasks WHERE id IN (${ids(model.rows.tasks)});`,
  );
  const operations = db.read(
    'si_emulator_test',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'reference',reference,'quantity',quantity)),'[]') FROM operations WHERE id IN (${ids(model.rows.operations)});`,
  );
  const issues = db.read(
    'si_test',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') FROM exchange_issues WHERE id IN (${ids(model.rows.exchange_issues)});`,
  );
  const faults = db.read(
    'si_emulator_test',
    `SELECT coalesce(jsonb_agg(jsonb_build_object('reference',reference,'operationId',bound_operation_id)),'[]') FROM faults WHERE reference IN (${model.rows.faults.map((row) => literal(row.reference)).join(',')});`,
  );
  for (const row of tasks) {
    const expected = model.rows.tasks.find((task) => task.id === row.id);
    if (
      row.reference !== expected.request_reference ||
      row.quantity !== expected.request_quantity ||
      row.owner !== expected.owner_id
    )
      throw new Error('Seed task ID collides with another dataset');
  }
  for (const row of operations) {
    const expected = model.rows.operations.find((operation) => operation.id === row.id);
    if (row.reference !== expected.reference || row.quantity !== expected.quantity)
      throw new Error('Seed operation ID collides with another dataset');
  }
  for (const row of faults) {
    const expected = model.rows.faults.find((fault) => fault.reference === row.reference);
    if (row.operationId !== expected.bound_operation_id)
      throw new Error('Seed fault reference is already used by another operation');
  }
  return { tasks, operations, issues, faults };
}

export function protectedData(db, model) {
  const tasks = model.rows.tasks.map((row) => literal(row.id)).join(',');
  const operations = model.rows.tasks.map((row) => literal(row.operation_id)).join(',');
  const issues = model.rows.exchange_issues.map((row) => literal(row.id)).join(',');
  const faults = model.rows.faults.map((row) => literal(row.reference)).join(',');
  const result = {};
  for (const [table, condition, database] of [
    ['tasks', `id NOT IN (${tasks})`, 'si_test'],
    ['task_history', `task_id NOT IN (${tasks})`, 'si_test'],
    ['delivery_attempts', `operation_id NOT IN (${operations})`, 'si_test'],
    ['delivery_queue', `operation_id NOT IN (${operations})`, 'si_test'],
    ['reconciliations', `task_id NOT IN (${tasks})`, 'si_test'],
    ['exchange_issues', `id NOT IN (${issues}) AND (task_id IS NULL OR task_id NOT IN (${tasks}))`, 'si_test'],
    ['command_receipts', 'true', 'si_test'],
    ['operations', `id NOT IN (${operations})`, 'si_emulator_test'],
    ['result_events', `operation_id NOT IN (${operations})`, 'si_emulator_test'],
    ['faults', `reference NOT IN (${faults})`, 'si_emulator_test'],
  ])
    result[table] = db.read(
      database,
      `SELECT jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),''))) FROM ${table} r WHERE ${condition};`,
    );
  return result;
}
