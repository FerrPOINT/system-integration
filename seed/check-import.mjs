import assert from 'node:assert/strict';
import { dataset } from './dataset.mjs';
import { postgres, insertion } from './postgres.mjs';

// Exercise the final serializer against actual column types and CHECK/UNIQUE constraints.
// Temporary tables belong to this connection and disappear on rollback/connection loss.
const db = postgres();
const users = db.read(
  'si_test',
  "SELECT jsonb_object_agg(username,id) FROM users WHERE username IN ('initiator.one','initiator.two','operator');",
);
const model = dataset(users, '2026-11-16T00:00:00.000Z');
for (const [database, tables] of [
  ['si_test', ['tasks', 'task_history', 'delivery_attempts', 'delivery_queue', 'reconciliations', 'exchange_issues']],
  ['si_emulator_test', ['operations', 'result_events', 'faults']],
]) {
  const sql =
    'BEGIN;\n' +
    tables
      .map(
        (table) =>
          `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP;\n` +
          insertion(table, model.rows[table]),
      )
      .join('') +
    `SELECT jsonb_build_object(${tables.map((table) => `'${table}',(SELECT count(*) FROM pg_temp.${table})`).join(',')}); ROLLBACK;`;
  const actual = JSON.parse(db.query(database, sql));
  assert.deepEqual(actual, Object.fromEntries(tables.map((table) => [table, model.rows[table].length])));
  console.log('Final import SQL accepted by PostgreSQL: ' + JSON.stringify(actual));
}
