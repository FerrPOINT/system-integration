import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from '../e2e/support';

const taskId = '00000000-0000-4000-8000-000000000001';
async function mockApi(page: Page, role = 'INITIATOR') {
  const state = { title: 'Original task', signedIn: true, failRead: false, failSession: false, failCsrf: false, loseWrite: false,
    commands: [] as { method: string; key: string | undefined; body: unknown }[], logins: 0, logouts: 0, assigned: false, resolved: false,
    revision: 1, latestSnapshot: 'snapshot', role, rejectCreate: false, badCreateReceipt: undefined as unknown,
    createKeys: new Set<string>(), holdWrite: undefined as Promise<void> | undefined, reads: [] as string[] };
  const task = () => ({ taskId, operationId: taskId, ownerId: '00000000-0000-4000-8000-000000000003', title: state.title,
    titleRevision: 1, request: { reference: 'REQ-000001', quantity: 25 }, createdAt: '2026-11-14T00:00:00Z', deliveryStatus: 'ACKNOWLEDGED', businessStatus: 'SUCCEEDED' });
  const snapshot = () => ({ reconciliationId: 'snapshot', taskId, operationId: taskId, checkedAt: '2026-11-14T00:00:00Z', checkedBy: task().ownerId,
    outcome: 'UNAVAILABLE', local: { request: task().request, deliveryStatus: task().deliveryStatus, businessStatus: task().businessStatus }, externalAvailability: 'UNAVAILABLE' });
  const issue = () => ({ issueId: taskId, taskId, operationId: taskId, issueRevision: state.revision, kind: 'RECONCILIATION_DIFFERENCE',
    status: state.resolved ? 'RESOLVED' : 'OPEN', summary: 'Fixture discrepancy', openedAt: '2026-11-14T00:00:00Z', latestReconciliationId: state.latestSnapshot,
    assignedTo: state.assigned ? task().ownerId : undefined,
    allowedActions: state.resolved ? [] : [...(state.assigned ? [] : ['TAKE_OWNERSHIP']), 'RECONCILE', 'ACKNOWLEDGE_DIFFERENCE'],
    resolution: state.resolved ? { action: 'ACKNOWLEDGE_DIFFERENCE', reason: 'Verified fixture', reconciliationId: 'snapshot', decidedAt: '2026-11-14T00:00:00Z', decidedBy: task().ownerId } : undefined });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const fail = () => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Gateway failure</html>' });
    if (path === '/api/csrf') return state.failCsrf ? fail() : route.fulfill({ json: { token: 'fixture' } });
    if (path === '/api/session') return state.failSession ? fail() : route.fulfill({ status: state.signedIn ? 200 : 401,
      json: state.signedIn ? { userId: task().ownerId, username: 'fixture', role: state.role } : { code: 'SESSION_REQUIRED' } });
    if (path === '/api/login') { state.signedIn = true; state.logins++; return route.fulfill({ status: 204 }); }
    if (path === '/api/logout') { state.signedIn = false; state.logouts++; state.failCsrf = true; return route.fulfill({ status: 204 }); }
    if (['POST', 'PATCH'].includes(request.method())) {
      state.commands.push({ method: request.method(), key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      if (path === '/api/tasks' && state.rejectCreate) return route.fulfill({ status: 400, json: { code: 'INVALID_REQUEST', detail: 'Fixture validation rejection' } });
      await state.holdWrite;
      if (path === '/api/tasks') state.createKeys.add(request.headers()['idempotency-key']);
      if (request.postDataJSON()?.title) state.title = request.postDataJSON().title;
      if (state.loseWrite) { state.loseWrite = false; return route.abort('failed'); }
      if (path === '/api/tasks' && state.badCreateReceipt !== undefined) return route.fulfill({ status: 201, json: state.badCreateReceipt });
      state.failRead = true;
      if (path.endsWith('/take')) { state.assigned = true; return route.fulfill({ json: issue() }); }
      if (path.endsWith('/resolve')) { state.resolved = true; return route.fulfill({ json: issue() }); }
      if (path.endsWith('/reconciliations')) return route.fulfill({ json: snapshot() });
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { taskId } });
    }
    state.reads.push(path);
    if (state.failRead) return fail();
    if (path === '/api/exchange/issues/' + taskId) return route.fulfill({ json: issue() });
    if (path.endsWith('/reconciliations/snapshot')) return route.fulfill({ json: snapshot() });
    if (path.endsWith('/history')) return route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
    if (path === '/api/tasks') return route.fulfill({ json: { items: [task()], page: 0, hasNext: false, totalItems: 1, totalPages: 1 } });
    if (path === '/api/tasks/' + taskId) return route.fulfill({ json: task() });
    throw new Error('Unexpected fixture API request: ' + path);
  });
  return state;
}

test('accepted rename and repeated read failures never resubmit PATCH', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Accepted title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Название сохранено.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('button', { name: 'Повторить обновление' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Accepted title', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
});

test('accepted reconciliation retries reads and opens the same saved snapshot', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выполнить сверку', exact: true })).toBeDisabled();
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

test('accepted ownership is not repeated to recover a failed issue read', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('button', { name: 'Взять разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ответственный назначен.' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('button', { name: 'Перенять разбор', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Ответственный назначен.' })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
});

test('accepted decision is preserved when refresh fails and recovery performs no second POST', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await selectChoice(page, 'Действие', 'Завершить разбор');
  await page.getByRole('textbox', { name: 'Причина решения', exact: true }).fill('Verified fixture');
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Причина решения', exact: true })).toHaveValue('Verified fixture');
  await expect(page.getByRole('textbox', { name: 'Причина решения', exact: true })).toBeDisabled();
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

test('operator decision draft survives cancelled departure and requires explicit discard', async ({ page }) => {
  await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await selectChoice(page, 'Действие', 'Завершить разбор');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Unsubmitted explanation');
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(reason).toHaveValue('Unsubmitted explanation');
  await expect(reason).toBeFocused();
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
});

test('refetch preserves a decision draft and requires explicit adoption of the new basis', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await selectChoice(page, 'Действие', 'Завершить разбор');
  await page.getByRole('textbox', { name: 'Причина решения', exact: true }).fill('Preserved explanation');
  state.revision = 2; state.latestSnapshot = 'new-snapshot';
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Черновик сохранён.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Причина решения', exact: true })).toHaveValue('Preserved explanation');
  await expect(page.getByRole('button', { name: 'Завершить разбор', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Использовать актуальную сверку' }).click();
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].body).toEqual({ expectedIssueRevision: 2, reconciliationId: 'new-snapshot', action: 'ACKNOWLEDGE_DIFFERENCE', reason: 'Preserved explanation' });
});

test('external resolution keeps an unsubmitted draft until the operator discards it', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await selectChoice(page, 'Действие', 'Завершить разбор');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Unsubmitted explanation');
  state.resolved = true; state.revision = 2;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  await expect(reason).toHaveValue('Unsubmitted explanation');
  await expect(page.getByRole('alert').filter({ hasText: 'Черновик сохранён.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завершить разбор', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Закрыть черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(reason).toBeFocused();
  await page.getByRole('button', { name: 'Закрыть черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(reason).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});

test('a screen render failure preserves the shell and recovers through the actual route tree', async ({ page }) => {
  await mockApi(page);
  await page.route(url => url.pathname === '/api/tasks/' + taskId, route => route.fulfill({ json: { taskId, title: 'Malformed task' } }));
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Cannot read properties');
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
});

test('a rejected page chunk has a controlled boundary and reload retries the module', async ({ page }) => {
  await mockApi(page);
  let attempts = 0;
  await page.route(url => url.pathname.endsWith('/features/tasks/ui/task-list-page.tsx'), route => {
    attempts++;
    return attempts === 1 ? route.abort('failed') : route.continue();
  });
  await page.goto('/tests/command-outcome.html?screen=list');
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Failed to fetch dynamically imported module');
  await page.getByRole('button', { name: 'Обновить страницу', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('initiator route gate redirects before reading operator data', async ({ page }) => {
  const state = await mockApi(page);
  const operatorReads: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/exchange/')) operatorReads.push(request.url()); });
  await page.goto('/tests/command-outcome.html?screen=issue');
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  expect(operatorReads).toEqual([]);
  expect(state.commands).toEqual([]);
});

test('operator cannot open the initiator create dialog through a direct URL', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=new');
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Новое задание', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Создать задание', exact: true })).toHaveCount(0);
  expect(state.commands).toEqual([]);
});

test('unknown URLs have a regular not-found screen under the shell', async ({ page }) => {
  await mockApi(page);
  await page.goto('/tests/command-outcome.html?screen=missing');
  await expect(page.getByRole('heading', { name: 'Страница не найдена', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
});

test('unknown rename outcome repeats the original input and idempotency key', async ({ page }) => {
  const state = await mockApi(page); state.loseWrite = true;
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Retry same title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Название сохранено.' })).toBeVisible();
  expect(state.commands).toHaveLength(2);
  expect(state.commands[0].key).toBeTruthy();
  expect(state.commands[1]).toEqual(state.commands[0]);
});

test('accepted create offers only read recovery after a failed follow-up', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html?screen=list');
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Created task');
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-000002');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Задание создано.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать', exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Created task', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

async function openCreate(page: Page, title: string) {
  await page.goto('/tests/command-outcome.html?screen=list');
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-456789');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
}

const refetchSession = (page: Page) => page.evaluate(() =>
  (window as unknown as { fixtureRefetchSession: () => Promise<void> }).fixtureRefetchSession());

test('unknown create freezes the submitted input and replays exactly one command', async ({ page }) => {
  const state = await mockApi(page); state.loseWrite = true;
  await openCreate(page, 'Uncertain create');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  state.failSession = true; await refetchSession(page);
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Uncertain create');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  state.failSession = false; await refetchSession(page);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Задание могло сохраниться');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить исходную отправку', exact: true })).toBeFocused();
  state.failCsrf = true;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  expect(state.commands).toHaveLength(1);
  state.failCsrf = false; state.rejectCreate = true;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  state.rejectCreate = false;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(3);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.commands[2]).toEqual(state.commands[0]);
  expect(state.createKeys.size).toBe(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uncertain create', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(3);
});

test('a failure before create dispatch leaves the form editable', async ({ page }) => {
  const state = await mockApi(page); state.failCsrf = true;
  await openCreate(page, 'Not dispatched');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeEnabled();
  expect(state.commands).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Edited before dispatch');
  state.failCsrf = false;
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].body).toMatchObject({ title: 'Edited before dispatch' });
});

test('leaving an uncertain create requires an explicit warning before a new command', async ({ page }) => {
  const state = await mockApi(page); state.loseWrite = true;
  await openCreate(page, 'Uncertain abandoned command');
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Задание могло сохраниться');
  await page.getByRole('button', { name: 'Закрыть без проверки', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Deliberate new command');
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-567890');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1].key).not.toBe(state.commands[0].key);
  expect(state.createKeys.size).toBe(2);
});

test('a definitive create rejection permits correcting the input', async ({ page }) => {
  const state = await mockApi(page); state.rejectCreate = true;
  await openCreate(page, 'Rejected create');
  await expect(page.getByRole('alert')).toContainText('Fixture validation rejection');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Corrected create');
  state.rejectCreate = false;
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.createKeys.size).toBe(1);
  expect(state.commands[1].body).toMatchObject({ title: 'Corrected create' });
  expect(state.commands[1].key).not.toBe(state.commands[0].key);
});

for (const receipt of [{}, { taskId: 12 }, { taskId: 'invalid-id' }]) {
  test('invalid create receipt retains the original command ' + JSON.stringify(receipt), async ({ page }) => {
    const state = await mockApi(page); state.badCreateReceipt = receipt;
    await openCreate(page, 'Receipt recovery');
    await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
    await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
    expect(state.reads.some(path => path === '/api/tasks/undefined' || path === '/api/tasks/invalid-id' || path === '/api/tasks/12')).toBe(false);
    expect(state.createKeys.size).toBe(1);
    state.badCreateReceipt = undefined;
    await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Задание создано.');
    expect(state.commands[1]).toEqual(state.commands[0]);
    expect(state.createKeys.size).toBe(1);
  });
}

test('background session failure preserves a dirty form through recovery', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Новое название', exact: true });
  await title.fill('Keep session draft');
  state.failSession = true; await refetchSession(page);
  await expect(title).toHaveValue('Keep session draft');
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  state.failSession = false; await refetchSession(page);
  await expect(title).toHaveValue('Keep session draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('initial session failure has a read-only retry without showing private content', async ({ page }) => {
  const state = await mockApi(page); state.failSession = true;
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить название', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toHaveCount(0);
  state.failSession = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  expect(state.logins).toBe(0);
});

test('background session failure does not detach a pending command observer', async ({ page }) => {
  const state = await mockApi(page);
  let release!: () => void;
  state.holdWrite = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Pending through session refresh');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  state.failSession = true; await refetchSession(page);
  await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toBeDisabled();
  state.failSession = false; await refetchSession(page); release();
  await expect(page.getByRole('region', { name: 'Состояние задания', exact: true }).getByRole('alert')).toContainText('Название сохранено.');
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending through session refresh', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

for (const identity of ['expired', 'role changed']) {
  test('session ' + identity + ' clears a private draft', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto('/tests/command-outcome.html');
    await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
    await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Private draft');
    if (identity === 'expired') state.signedIn = false; else state.role = 'OPERATOR';
    await refetchSession(page);
    await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toHaveCount(0);
    if (identity === 'expired') {
      await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount())).toBe(0);
    } else await expect(page.getByRole('link', { name: 'Разбор обмена', exact: true })).toBeVisible();
  });
}

test('accepted logout clears private queries before any further token read', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Меню приложения', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  expect(state.logouts).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount())).toBe(0);
});

test('login acknowledgement followed by session failure recovers with GET only', async ({ page }) => {
  const state = await mockApi(page); state.signedIn = false;
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
  await page.getByLabel('Пароль *', { exact: true }).fill('fixture-password');
  state.failSession = true;
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('Неверный логин');
  state.failSession = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  expect(state.logins).toBe(1);
});
