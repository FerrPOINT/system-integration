import { mkdir, writeFile } from 'node:fs/promises';
import { ApiSession, localOrigin, parallel } from '../support/http.mjs';
import { loadEnvironment } from './environment.mjs';

const profile = process.env.SI_LOAD_PROFILE || 'nf08';
if (!['nf08', 'nf08-external', 'capacity', 'steady'].includes(profile)) throw new Error('SI_LOAD_PROFILE must be nf08, nf08-external, capacity or steady');
const initialCount = profile === 'capacity' ? 10000 : 5000;
loadEnvironment();

const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
const users = ['initiator.one', 'initiator.two'];
const accounts = await Promise.all(users.map(async username => {
  const session = new ApiSession(origin); await session.login(username, process.env.SI_DEMO_PASSWORD);
  if ((await session.get('/api/tasks')).items.length) throw new Error('The isolated load databases must be empty; run the documented reset first');
  return { username, session, tasks: [] };
}));

const records = Array.from({ length: initialCount }, (_, i) => i);
await parallel(records, 8, async i => {
  const owner = accounts[i % 2];
  const result = await owner.session.command('POST', '/api/tasks', {
    title: `${profile} initial ${i}`, request: { reference: `REQ-${100000 + i}`, quantity: 25 },
  });
  owner.tasks.push(result.taskId);
});
const deadline = Date.now() + 600_000;
while (true) {
  let pending = 0;
  for (const owner of accounts) {
    let total = 0;
    for (let page = 0; ; page++) {
      const result = await owner.session.get(`/api/tasks?page=${page}`);
      total += result.items.length;
      pending += result.items.filter(task => task.businessStatus !== 'SUCCEEDED').length;
      if (!result.hasNext) break;
    }
    if (total !== initialCount / 2) throw new Error(`Expected ${initialCount / 2} initial records for ${owner.username}, received ${total}`);
  }
  if (pending === 0) break;
  if (Date.now() >= deadline) throw new Error(`Initial exchange did not drain: ${pending} records remain`);
  console.log(`Waiting for ${pending} initial operations`);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const result = { origin, profile, initialCount, preparedAt: new Date().toISOString(), accounts: accounts.map(({ username, tasks }) => ({ username, tasks })) };
const target = new URL('../results/', import.meta.url);
await mkdir(target, { recursive: true });
await writeFile(new URL('load-dataset.json', target), JSON.stringify(result, null, 2));
console.log('Prepared exactly ' + initialCount + ' completed initial records');
