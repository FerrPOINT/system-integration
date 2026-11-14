import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from '../e2e/support';

const taskId = '00000000-0000-4000-8000-000000000001';
async function mockApi(page: Page, role = 'INITIATOR') {
  const state = { title: 'Original task', signedIn: true, failRead: false, failSession: false, failCsrf: false, loseWrite: false,
    commands: [] as { method: string; key: string | undefined; body: unknown }[], logins: 0, logouts: 0, assigned: false, resolved: false };
  const task = () => ({ taskId, operationId: taskId, ownerId: '00000000-0000-4000-8000-000000000003', title: state.title,
    titleRevision: 1, request: { reference: 'REQ-000001', quantity: 25 }, createdAt: '2026-11-14T00:00:00Z', deliveryStatus: 'ACKNOWLEDGED', businessStatus: 'SUCCEEDED' });
  const snapshot = () => ({ reconciliationId: 'snapshot', taskId, operationId: taskId, checkedAt: '2026-11-14T00:00:00Z', checkedBy: task().ownerId,
    outcome: 'UNAVAILABLE', local: { request: task().request, deliveryStatus: task().deliveryStatus, businessStatus: task().businessStatus }, externalAvailability: 'UNAVAILABLE' });
  const issue = () => ({ issueId: taskId, taskId, operationId: taskId, issueRevision: state.assigned ? 2 : 1, kind: 'RECONCILIATION_DIFFERENCE',
    status: state.resolved ? 'RESOLVED' : 'OPEN', summary: 'Fixture discrepancy', openedAt: '2026-11-14T00:00:00Z', latestReconciliationId: 'snapshot',
    assignedTo: state.assigned ? task().ownerId : undefined,
    allowedActions: state.resolved ? [] : [...(state.assigned ? [] : ['TAKE_OWNERSHIP']), 'RECONCILE', 'ACKNOWLEDGE_DIFFERENCE'],
    resolution: state.resolved ? { action: 'ACKNOWLEDGE_DIFFERENCE', reason: 'Verified fixture', reconciliationId: 'snapshot', decidedAt: '2026-11-14T00:00:00Z', decidedBy: task().ownerId } : undefined });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const fail = () => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Gateway failure</html>' });
    if (path === '/api/csrf') return state.failCsrf ? fail() : route.fulfill({ json: { token: 'fixture' } });
    if (path === '/api/session') return state.failSession ? fail() : route.fulfill({ status: state.signedIn ? 200 : 401,
      json: state.signedIn ? { userId: task().ownerId, username: 'fixture', role } : { code: 'SESSION_REQUIRED' } });
    if (path === '/api/login') { state.signedIn = true; state.logins++; return route.fulfill({ status: 204 }); }
    if (path === '/api/logout') { state.signedIn = false; state.logouts++; state.failCsrf = true; return route.fulfill({ status: 204 }); }
    if (['POST', 'PATCH'].includes(request.method())) {
      state.commands.push({ method: request.method(), key: request.headers()['idempotency-key'], body: request.postDataJSON() });
      if (request.postDataJSON()?.title) state.title = request.postDataJSON().title;
      if (state.loseWrite) { state.loseWrite = false; return route.abort('failed'); }
      state.failRead = true;
      if (path.endsWith('/take')) { state.assigned = true; return route.fulfill({ json: issue() }); }
      if (path.endsWith('/resolve')) { state.resolved = true; return route.fulfill({ json: issue() }); }
      if (path.endsWith('/reconciliations')) return route.fulfill({ json: snapshot() });
      return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { taskId } });
    }
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
