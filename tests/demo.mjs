import { mkdir, writeFile } from 'node:fs/promises';
import { ApiSession, localOrigin } from './support/http.mjs';

const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19580');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19581');
const [command, reference, mode] = process.argv.slice(2);
const faultModes = ['UNAVAILABLE', 'DROP_RESPONSE_AFTER_EXECUTION', 'DUPLICATE_RESULT', 'DELAY_RESULT'];

async function fault(method, ref, value) {
  if (!/^REQ-[0-9]{6}$/.test(ref)) throw new Error('Expected REQ- and six digits');
  const response = await fetch(external + '/test/faults/' + ref, { method, signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json' }, body: value ? JSON.stringify({ mode: value }) : undefined });
  if (response.status !== 204) throw new Error(`Fault command failed: HTTP ${response.status}`);
}

async function login(username) {
  if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
  const session = new ApiSession(origin); await session.login(username, process.env.SI_DEMO_PASSWORD); return session;
}

if (command === 'fault') {
  if (!faultModes.includes(mode)) throw new Error('Unknown fault mode');
  await fault('PUT', reference, mode);
} else if (command === 'clear') {
  await fault('DELETE', reference);
} else if (command === 'inspect') {
  if (!/^[0-9a-f-]{36}$/i.test(reference || '')) throw new Error('Expected an operation UUID');
  const response = await fetch(external + '/operations/' + reference, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`External state: HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
} else if (command === 'seed') {
  const initiators = await Promise.all(['initiator.one', 'initiator.two'].map(login));
  const operator = await login('operator');
  const cases = [
    { title: 'Демо: успешное исполнение', quantity: 25 },
    { title: 'Демо: бизнес-отказ', quantity: 150 },
    { title: 'Демо: исполнитель недоступен', quantity: 25, fault: 'UNAVAILABLE' },
    { title: 'Демо: ответ потерян после исполнения', quantity: 25, fault: 'DROP_RESPONSE_AFTER_EXECUTION' },
    { title: 'Демо: дубликат результата', quantity: 25, fault: 'DUPLICATE_RESULT' },
    { title: 'Демо: запоздалый промежуточный снимок', quantity: 25, fault: 'DELAY_RESULT' },
  ];
  for (const [index, item] of cases.entries()) {
    item.reference = `REQ-${900001 + index}`; item.owner = index % 2;
    if (item.fault) await fault('PUT', item.reference, item.fault);
    const key = `00000000-0000-4000-8000-${String(900001 + index).padStart(12, '0')}`;
    item.taskId = (await initiators[item.owner].command('POST', '/api/tasks', {
      title: item.title, request: { reference: item.reference, quantity: item.quantity },
    }, key)).taskId;
  }
  // Five calls plus 82 seconds of backoff and HTTP deadlines.
  const deadline = Date.now() + 120_000;
  while (true) {
    let ready = true;
    for (const item of cases) {
      item.task = await initiators[item.owner].get('/api/tasks/' + item.taskId);
      if (item.fault === 'UNAVAILABLE') {
        let found = false;
        for (let page = 0; ; page++) {
          const issues = await operator.get('/api/exchange/issues?status=OPEN&page=' + page);
          found = issues.items.some(issue => issue.taskId === item.taskId && issue.kind === 'DELIVERY_DELAYED');
          if (found || !issues.hasNext) break;
        }
        ready &&= found;
      } else if (item.fault === 'DROP_RESPONSE_AFTER_EXECUTION') ready &&= item.task.deliveryStatus === 'ACKNOWLEDGED';
      else ready &&= ['SUCCEEDED', 'REJECTED'].includes(item.task.businessStatus);
    }
    if (ready) break;
    if (Date.now() >= deadline) throw new Error('The demo scenarios did not reach their expected states');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const dropped = cases.find(item => item.fault === 'DROP_RESPONSE_AFTER_EXECUTION');
  dropped.reconciliation = await operator.command('POST', `/api/tasks/${dropped.taskId}/reconciliations`, undefined,
    '00000000-0000-4000-8000-000000900004');
  await mkdir(new URL('results/', import.meta.url), { recursive: true });
  const result = { origin, external, preparedAt: new Date().toISOString(), cases };
  await writeFile(new URL('results/demo.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log('Prepared six cases. Accounts: initiator.one, initiator.two, operator. Password: SI_DEMO_PASSWORD.');
  console.log(cases.map(item => ({ title: item.title, taskId: item.taskId, operationId: item.task.operationId,
    delivery: item.task.deliveryStatus, result: item.task.businessStatus })));
} else {
  throw new Error('Usage: node tests/demo.mjs seed | fault REQ-900003 UNAVAILABLE | clear REQ-900003 | inspect <operation-id>');
}
