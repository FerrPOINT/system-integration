import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ApiSession, localOrigin } from './support/http.mjs';
import { createHeldDelivery, releaseHeldDelivery, operationUuid } from './support/held-delivery.mjs';

const origin = localOrigin(process.env.SI_BACKEND_URL || 'http://127.0.0.1:19680');
const external = localOrigin(process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681');
const [command, operationId, mode] = process.argv.slice(2);
const faultModes = ['UNAVAILABLE', 'DROP_RESPONSE_AFTER_EXECUTION', 'DUPLICATE_RESULT', 'DELAY_RESULT'];

async function fault(method, ref, value) {
  const response = await fetch(external + '/test/faults/' + operationUuid(ref), {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json' },
    body: value ? JSON.stringify({ mode: value }) : undefined,
  });
  if (response.status !== 204) throw new Error(`Fault command failed: HTTP ${response.status}`);
}

async function login(username) {
  if (!process.env.SI_DEMO_PASSWORD) throw new Error('SI_DEMO_PASSWORD is required');
  const session = new ApiSession(origin);
  await session.login(username, process.env.SI_DEMO_PASSWORD);
  return session;
}

if (command === 'seed' || command === 'verify-seed') {
  await import('../seed/run.mjs');
} else if (command === 'fault') {
  if (!faultModes.includes(mode)) throw new Error('Unknown fault mode');
  await fault('PUT', operationId, mode);
} else if (command === 'clear') {
  await fault('DELETE', operationId);
} else if (command === 'inspect') {
  const response = await fetch(external + '/operations/' + operationUuid(operationId), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`External state: HTTP ${response.status}`);
  console.log(JSON.stringify(await response.json(), null, 2));
} else if (command === 'scenarios') {
  const { postgres } = await import('../seed/postgres.mjs');
  const db = postgres('load');
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
    item.owner = index % 2;
    const owner = initiators[item.owner];
    item.createKey = randomUUID();
    const create = async () => {
      const { taskId } = await owner.command(
        'POST',
        '/api/tasks',
        { title: item.title, quantity: item.quantity },
        item.createKey,
      );
      return owner.get('/api/tasks/' + taskId);
    };
    const created = item.fault ? await createHeldDelivery(create) : await create();
    if (item.fault) {
      await fault('PUT', created.operationId, item.fault);
      releaseHeldDelivery(created.operationId);
    }
    item.taskId = created.taskId;
    item.observedStates = [];
    item.observedStates.push(created.deliveryStatus + '/' + created.businessStatus);
  }
  // Five calls plus 82 seconds of backoff and HTTP deadlines.
  const deadline = Date.now() + 120_000;
  while (true) {
    let ready = true;
    for (const item of cases) {
      item.task = await initiators[item.owner].get('/api/tasks/' + item.taskId);
      const state = item.task.deliveryStatus + '/' + item.task.businessStatus;
      if (!item.observedStates.includes(state)) item.observedStates.push(state);
      if (item.fault === 'UNAVAILABLE') {
        let found = false;
        for (let page = 0; ; page++) {
          const issues = await operator.get('/api/exchange/issues?status=OPEN&page=' + page);
          found = issues.items.some((issue) => issue.taskId === item.taskId && issue.kind === 'DELIVERY_DELAYED');
          if (found || !issues.hasNext) break;
        }
        ready &&= found;
      } else if (item.fault === 'DROP_RESPONSE_AFTER_EXECUTION') ready &&= item.task.deliveryStatus === 'ACKNOWLEDGED';
      else ready &&= item.task.businessStatus === (item.quantity > 100 ? 'REJECTED' : 'SUCCEEDED');
    }
    if (ready) break;
    if (Date.now() >= deadline) throw new Error('The demo scenarios did not reach their expected states');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const dropped = cases.find((item) => item.fault === 'DROP_RESPONSE_AFTER_EXECUTION');
  for (const item of cases.filter((item) => item.fault !== 'UNAVAILABLE')) {
    const response = await fetch(external + '/operations/' + item.task.operationId, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('The demo operation is missing in the emulator');
    const actual = await response.json();
    if (actual.executions !== 1 || actual.result?.status !== (item.quantity > 100 ? 'REJECTED' : 'SUCCEEDED'))
      throw new Error('The demo operation does not have its expected single execution and result');
  }
  const duplicate = cases.find((item) => item.fault === 'DUPLICATE_RESULT');
  duplicate.publishedCopies = db.read(
    'emulator',
    `SELECT to_jsonb(count(*)) FROM result_events WHERE operation_id='${duplicate.task.operationId}'::uuid AND version=2 AND cursor IS NOT NULL;`,
  );
  if (duplicate.publishedCopies !== 2) throw new Error('Expected both publications of the duplicated result');
  const delayed = cases.find((item) => item.fault === 'DELAY_RESULT');
  await fault('DELETE', delayed.task.operationId);
  const releaseDeadline = Date.now() + 10_000;
  while (true) {
    const history = await initiators[delayed.owner].get('/api/tasks/' + delayed.taskId + '/history?size=100');
    if (history.items.some((event) => event.type === 'RESULT_IGNORED' && event.resultVersion === 1)) break;
    if (Date.now() >= releaseDeadline) throw new Error('The released stale result was not recorded as ignored');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  delayed.staleResultIgnored = true;
  delayed.task = await initiators[delayed.owner].get('/api/tasks/' + delayed.taskId);
  if (delayed.task.businessStatus !== 'SUCCEEDED') throw new Error('The stale result changed the accepted final state');
  dropped.reconciliation = await operator.command(
    'POST',
    `/api/tasks/${dropped.taskId}/reconciliations`,
    undefined,
    randomUUID(),
  );
  await mkdir(new URL('results/', import.meta.url), { recursive: true });
  const result = { origin, external, preparedAt: new Date().toISOString(), cases };
  await writeFile(new URL('results/demo.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log('Prepared six cases. Accounts: initiator.one, initiator.two, operator. Password: SI_DEMO_PASSWORD.');
  console.log(
    cases.map((item) => ({
      title: item.title,
      taskId: item.taskId,
      operationId: item.task.operationId,
      delivery: item.task.deliveryStatus,
      result: item.task.businessStatus,
    })),
  );
} else {
  throw new Error(
    'Usage: node tests/demo.mjs seed | verify-seed | scenarios | fault <operation-id> UNAVAILABLE | clear <operation-id> | inspect <operation-id>',
  );
}
