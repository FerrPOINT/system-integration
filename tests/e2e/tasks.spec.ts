import { test, expect } from '@playwright/test';
import { login } from './support';

test('TC-01 / TC-09: keyboard creation, immutable request, rename and responsive list', async ({ page }, testInfo) => {
  await login(page);
  await page.getByRole('link', { name: 'Создать задание' }).click();
  const name = `E2E ${testInfo.project.name} ${crypto.randomUUID()}`;
  await page.getByLabel('Название', { exact: true }).fill(name);
  await page.getByLabel('Номер заявки').fill('REQ-800001');
  await page.getByLabel('Количество', { exact: true }).fill('25');
  await page.getByLabel('Количество', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
  await expect(page.getByText('Получено исполнителем', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByLabel('Новое название').fill(name + ' обновлено');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: name + ' обновлено', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
  await expect(page.getByText(/Название изменено:/)).toBeVisible();
  await page.getByRole('link', { name: '← К заданиям', exact: true }).click();
  await expect(page.getByRole('link', { name: name + ' обновлено', exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.locator('.task-cards > li').first()).toBeVisible();
  } else await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('TC-08: logout clears owner data and another initiator cannot open a foreign card', async ({ page, context }) => {
  await login(page);
  const csrf = await (await context.request.get('/api/csrf')).json();
  const created = await context.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: 'Закрытое задание ' + crypto.randomUUID(), request: { reference: 'REQ-800002', quantity: 25 } },
  });
  expect(created.status()).toBe(201);
  const { taskId } = await created.json();
  await page.goto('/tasks/' + taskId);
  await expect(page.getByRole('button', { name: 'Изменить название' })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'initiator.two');
  await page.goto('/tasks/' + taskId);
  await expect(page.getByRole('alert')).toContainText('Запись не найдена');
  await expect(page.getByRole('button', { name: 'Изменить название' })).toHaveCount(0);
});

test('TC-01 / TC-09: business rejection, visible loading and recovery to the filtered registry', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Создать задание' }).click();
  const name = 'E2E отказ ' + crypto.randomUUID();
  await page.getByLabel('Название', { exact: true }).fill(name);
  await page.getByLabel('Номер заявки').fill('REQ-800004');
  await page.getByLabel('Количество', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('Отклонено', { exact: true })).toBeVisible();
  await expect(page.getByText('Количество превышает 100 единиц', { exact: true })).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks?*', async route => { await held; await route.continue(); });
  try {
    await page.goto('/tasks?businessStatus=REJECTED');
    await expect(page.getByRole('status')).toContainText('Загрузка');
  } finally { release(); }
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('TC-09 / TC-12: empty filter, server error recovery and UTC rendering', async ({ page }) => {
  await login(page);
  const csrf = await (await page.request.get('/api/csrf')).json();
  const created = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: 'E2E UTC ' + crypto.randomUUID(), request: { reference: 'REQ-800003', quantity: 25 } },
  });
  expect(created.status()).toBe(201);
  const { taskId } = await created.json();
  await page.goto('/tasks?createdFrom=2000-01-01T00%3A00%3A00Z&createdTo=2000-01-02T00%3A00%3A00Z');
  await expect(page.getByRole('heading', { name: 'Заданий пока нет' })).toBeVisible();
  await page.route('**/api/tasks?*', route => route.fulfill({ status: 502, contentType: 'text/html',
    body: '<html><body>502 Bad Gateway</body></html>' }));
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось выполнить запрос. Повторите попытку.');
  await page.unroute('**/api/tasks?*');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заданий пока нет' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Создать задание' })).toBeVisible();
  await page.goto('/tasks/' + taskId);
  const task = await (await page.request.get('/api/tasks/' + taskId)).json();
  const time = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(task.createdAt)) + ' UTC';
  await expect(page.getByText(time, { exact: true }).first()).toBeVisible();
  const otherZone = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin, timezoneId: 'America/Los_Angeles' });
  try {
    const other = await otherZone.newPage();
    await login(other);
    await other.goto('/tasks/' + taskId);
    await expect(other.getByText(time, { exact: true }).first()).toBeVisible();
  } finally { await otherZone.close(); }
});

test('TC-08 / TC-09: expired server session clears protected screens and allows another login', async ({ page }) => {
  await login(page);
  const token = await (await page.request.get('/api/csrf')).json();
  expect((await page.request.post('/api/logout', { headers: { 'X-CSRF-TOKEN': token.token } })).status()).toBe(204);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toHaveCount(0);
  await login(page, 'initiator.two');
});


test('TC-08: session refresh removes the previous owner cache before an in-place login', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date());
  await login(page);
  const csrf = await (await page.request.get('/api/csrf')).json();
  const title = 'E2E приватный кеш ' + crypto.randomUUID();
  const created = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title, request: { reference: 'REQ-800005', quantity: 25 } },
  });
  expect(created.status()).toBe(201);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новое задание', exact: true })).toBeVisible();
  expect((await page.request.post('/api/logout', { headers: { 'X-CSRF-TOKEN': csrf.token } })).status()).toBe(204);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const expired = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session' && response.status() === 401);
  await context.setOffline(false);
  await expired;
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  // Keep the same SPA: navigating or reloading would hide a stale QueryClient cache.
  await page.getByLabel('Логин', { exact: true }).fill('initiator.two');
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.SI_DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новое задание', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Отмена', exact: true }).click();
  await expect(page.getByText('Сохранённые задания', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
});
