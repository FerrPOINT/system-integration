import { test, expect } from '@playwright/test';
import { login } from './support';

const external = process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19581';

test.afterEach(async ({ request }) => {
  for (const reference of ['REQ-810001', 'REQ-810002', 'REQ-820001', 'REQ-820002'])
    expect((await request.delete(`${external}/test/faults/${reference}`)).status()).toBe(204);
});

test('TC-03 / TC-07: lost reply, independent execution, reconciliation and operator decision', async ({ page, request }, info) => {
  const reference = info.project.name === 'mobile' ? 'REQ-810002' : 'REQ-810001';
  expect((await request.delete(`${external}/test/faults/${reference}`)).status()).toBe(204);
  expect((await request.put(`${external}/test/faults/${reference}`, { data: { mode: 'DROP_RESPONSE_AFTER_EXECUTION' } })).status()).toBe(204);
  await login(page);
  await page.getByRole('link', { name: 'Создать задание' }).click();
  const title = 'E2E разбор ' + crypto.randomUUID();
  await page.getByLabel('Название', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки', { exact: true }).fill(reference);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Получено исполнителем', { exact: true })).toBeVisible();
  await expect(page.getByText('Ожидает исполнения', { exact: true })).toBeVisible();
  const taskPath = new URL(page.url()).pathname;
  const taskId = taskPath.split('/').at(-1);
  const local = await (await page.request.get('/api/tasks/' + taskId)).json();
  const actual = await (await request.get(`${external}/operations/${local.operationId}`)).json();
  expect(actual.executions).toBe(1);
  expect(actual.result.status).toBe('SUCCEEDED');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'operator');
  await page.goto(taskPath);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Обнаружено расхождение', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к разбору и решению' }).click();
  const operator = await (await page.request.get('/api/session')).json();
  await page.getByRole('button', { name: 'Взять разбор', exact: true }).click();
  await expect(page.getByText(operator.userId, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Взять разбор', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Действие', exact: true }).selectOption('APPLY_EXTERNAL_RESULT');
  await page.getByLabel('Причина решения', { exact: true }).fill('Проверено фактическое исполнение, принимаю сохранённый результат');
  await page.getByRole('button', { name: 'Принять внешний результат', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть задание и историю' }).click();
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка' })).toBeVisible();
  await expect(page.locator('.comparison-grid .snapshot').first()).toContainText('Ожидает исполнения');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const history = await (await page.request.get(`/api/tasks/${taskId}/history`)).json();
  expect(history.items.filter((event: { type: string; actor: string }) => event.type === 'ISSUE_RESOLVED' && event.actor === 'USER')).toHaveLength(1);
});

test('TC-06 / TC-07: conflicting external input is stopped explicitly without accepting its result', async ({ page, request }, info) => {
  const reference = info.project.name === 'mobile' ? 'REQ-820002' : 'REQ-820001';
  await request.delete(`${external}/test/faults/${reference}`);
  expect((await request.put(`${external}/test/faults/${reference}`, { data: { mode: 'UNAVAILABLE' } })).status()).toBe(204);
  await login(page);
  const csrf = await (await page.request.get('/api/csrf')).json();
  const created = await page.request.post('/api/tasks', { headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: 'E2E ошибка протокола ' + crypto.randomUUID(), request: { reference, quantity: 25 } } });
  expect(created.status()).toBe(201);
  const { taskId } = await created.json();
  const initial = await (await page.request.get('/api/tasks/' + taskId)).json();
  expect((await request.put(`${external}/operations/${initial.operationId}`, { data: { reference: 'REQ-829999', quantity: 25 } })).status()).toBe(202);
  await expect.poll(async () => (await (await page.request.get('/api/tasks/' + taskId)).json()).deliveryStatus).toBe('NEEDS_REVIEW');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'operator');
  await page.goto('/tasks/' + taskId);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Обнаружено расхождение' })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к разбору и решению' }).click();
  await expect(page.getByRole('option', { name: 'Принять внешний результат', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Действие', exact: true }).selectOption('ACKNOWLEDGE_DIFFERENCE');
  await page.getByLabel('Причина решения', { exact: true }).fill('ID занят операцией с другим запросом, прекращаю отправку');
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён' })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть задание и историю' }).click();
  await expect(page.getByText('Отправка остановлена', { exact: true })).toBeVisible();
  await expect(page.getByText('Ожидает исполнения', { exact: true })).toBeVisible();
});
