import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dataset } from './dataset.mjs';
import { id } from './catalog.mjs';
import { postgres, existingDataset, insertDataset, protectedData, literal } from './postgres.mjs';
import { verify } from './verify.mjs';
import { writeShowcase } from './report.mjs';

const command = process.argv[2];
const pristine = process.argv[3] === '--pristine';
if (process.argv.length > (pristine && command === 'verify-seed' ? 4 : 3))
  throw new Error('Only verify-seed supports --pristine');
if (!['seed', 'verify-seed'].includes(command))
  throw new Error('Use node --env-file=.env tests/demo.mjs seed | verify-seed');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
const db = postgres();
const users = db.read(
  'si_test',
  "SELECT jsonb_object_agg(username,id) FROM users WHERE username IN ('initiator.one','initiator.two','operator');",
);
const first = db.read(
  'si_test',
  `SELECT coalesce(jsonb_agg(created_at),'[]') FROM tasks WHERE id=${literal(id('task/0'))};`,
);
// Recover the original anchor from task 0 so manifests remain stable on another machine or day.
const anchor = first.length
  ? new Date(Date.parse(first[0]) + 86400000 - 3600000).toISOString()
  : new Date(Math.floor(Date.now() / 86400000) * 86400000 - 86400000).toISOString();
const model = dataset(users, anchor);
const existing = existingDataset(db, model);
const before = protectedData(db, model);
const results = new URL('../tests/results/', import.meta.url);
await mkdir(results, { recursive: true });
let inserted = { insertedTasks: 0, insertedIssues: 0 };
if (command === 'seed') inserted = insertDataset(db, model, existing);
const after = protectedData(db, model);
assert.deepEqual(after, before, 'Existing unrelated data changed during seed loading');
await writeFile(
  new URL('showcase-preservation.json', results),
  JSON.stringify({ verifiedAt: new Date().toISOString(), before, after }, null, 2),
);
console.log(
  `Demo dataset: ${inserted.insertedTasks} new tasks; ${inserted.insertedIssues} new issues. Verifying the actual API...`,
);
const summary = await verify(db, model, { fresh: pristine || inserted.insertedTasks === model.rows.tasks.length });
const current = existingDataset(db, model);
const titles = new Map(current.tasks.map((task) => [task.id, task.title]));
const statuses = new Map(current.issues.map((issue) => [issue.id, issue.status]));
const result = {
  version: model.version,
  anchor,
  verifiedAt: new Date().toISOString(),
  sourceCommit: db.resources.find((resource) => resource.service === 'backend').sourceCommit,
  ...inserted,
  summary,
  preserved: after,
  examples: model.examples.map((item) => ({
    ...item,
    title: titles.get(item.taskId),
    url: `http://127.0.0.1:19673/tasks/${item.taskId}`,
    issueUrl: item.issueId ? `http://127.0.0.1:19673/issues/${item.issueId}` : null,
  })),
  generalIssues: model.rows.exchange_issues
    .filter((issue) => !issue.task_id)
    .map((issue) => ({
      issueId: issue.id,
      status: statuses.get(issue.id),
      url: 'http://127.0.0.1:19673/issues/' + issue.id,
    })),
};
await writeShowcase(result);
console.log(JSON.stringify(summary));
console.log('Existing data preserved. Scenario links: tests/results/showcase.md and showcase.json');
