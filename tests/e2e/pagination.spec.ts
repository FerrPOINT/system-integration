import { test, expect } from '@playwright/test';
import { login, selectChoice } from './support';

test('UI-09: counted pages preserve filters and filters apply without a submit button', async ({ page }, info) => {
  await login(page);
  let initial = await (await page.request.get('/api/tasks')).json();
  if (initial.totalItems < 21) {
    const csrf = await (await page.request.get('/api/csrf')).json();
    for (let i = initial.totalItems; i < 21; i++) {
      const reply = await page.request.post('/api/tasks', { headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
        data: { title: 'E2E pagination ' + crypto.randomUUID(), request: { reference: 'REQ-880001', quantity: 25 } } });
      expect(reply.status()).toBe(201);
    }
    await page.reload();
    initial = await (await page.request.get('/api/tasks')).json();
  }
  async function expectSummary(current: number, total: number) {
    await expect.poll(async () => {
      const size=Number(new URL(page.url()).searchParams.get('size') || 20);
      return await page.locator('.base-page-summary').innerText() === 'Страница ' + current + ' из ' + Math.ceil(total/size) + ' · Всего записей: ' + total;
    }).toBe(true);
  }
  await expectSummary(1,initial.totalItems);
  await page.getByRole('button', { name: 'Страница 2', exact: true }).click();
  await expect(page).toHaveURL(/page=1/);
  await expectSummary(2,initial.totalItems);
  const filters = page.locator('.filter-panel');
  if (info.project.name === 'mobile') await filters.locator('summary').click();
  const filtered = page.waitForResponse(response => response.url().includes('/api/tasks?') && response.url().includes('businessStatus=SUCCEEDED') && response.status() === 200);
  await selectChoice(page, 'Результат', 'Выполнено');
  const result = await (await filtered).json();
  await expect(page).toHaveURL(/businessStatus=SUCCEEDED/);
  await expect(page).not.toHaveURL(/page=/);
  await expect(page.getByRole('button', { name: 'Применить', exact: true })).toHaveCount(0);
  if (result.totalItems) await expectSummary(1,result.totalItems);
  await selectChoice(page, 'Результат', 'Все результаты');
  await expect(page).not.toHaveURL(/businessStatus=/);
  const from = page.getByLabel('Создано с (UTC, включительно)', { exact: true });
  const to = page.getByLabel('Создано до (UTC, не включая)', { exact: true });
  const dated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tasks' &&
    new URL(response.url()).searchParams.has('createdFrom') && response.status() === 200);
  await from.fill('2026-11-01T00:00');
  await dated;
  await expect(page).toHaveURL(/createdFrom=/);
  await expect(from).toBeFocused();
  await to.fill('2026-10-01T00:00');
  await expect(page.getByText('Начало периода должно быть раньше конца.', { exact: true })).toBeVisible();
  await to.fill('2026-12-01T00:00');
  await expect(page.getByText('Начало периода должно быть раньше конца.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(from).toHaveValue('');
  await expect(to).toHaveValue('');
  await page.goto('/tasks?page=999999');
  await expect(page.getByText('Страница 1000000 не найдена · Всего страниц: ' + initial.totalPages, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Страница 1', exact: true }).click();
  await expect(page).toHaveURL(/page=0/);
});

test('UI-09: invalid URL filters stay local and valid filters still load', async ({ page }) => {
  await login(page);
  const invalid = ['businessStatus=toString', 'businessStatus=constructor', 'createdFrom=not-a-date', 'createdTo=not-a-date', 'size=0', 'size=101', 'size=not-a-number'];
  const requests: URL[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/tasks') requests.push(url);
  });
  for (const query of invalid) {
    await page.goto('/tasks?' + query);
    await expect(page.getByText('Некорректные параметры страницы. Сбросьте фильтры.', { exact: true })).toBeVisible();
  }
  expect(requests.filter(url => invalid.some(query => {
    const [name, value] = query.split('=');
    return url.searchParams.get(name) === value;
  }))).toHaveLength(0);
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/tasks' && url.searchParams.get('businessStatus') === 'SUCCEEDED' &&
      url.searchParams.has('createdFrom') && response.status() === 200;
  });
  await page.goto('/tasks?businessStatus=SUCCEEDED&createdFrom=2020-01-01T00%3A00%3A00Z');
  await loaded;
  await expect(page.getByLabel('Создано с (UTC, включительно)', { exact: true })).toHaveValue('2020-01-01T00:00');
  await expect(page.getByText('Некорректные параметры страницы. Сбросьте фильтры.', { exact: true })).toHaveCount(0);
});

test('UI-10: lost create response keeps the command key and invalidates the cached registry', async ({ page }) => {
  await login(page);
  const before = await (await page.request.get('/api/tasks')).json();
  const keys: string[] = [];
  const ids: string[] = [];
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    keys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    ids.push((await response.json()).taskId);
    if (keys.length === 1) await route.fulfill({ status: 503, contentType: 'text/html', body: 'Reply lost after commit' });
    else await route.fulfill({ response });
  });
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  const title = 'E2E command replay ' + crypto.randomUUID();
  await page.getByLabel('Название *', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки').fill('REQ-880002');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]); expect(ids[0]).toBe(ids[1]);
  expect((await (await page.request.get('/api/tasks')).json()).totalItems).toBe(before.totalItems + 1);
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});

test('UI-11: changing account outside the SPA clears the previous private card', async ({ page, context }) => {
  await login(page);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  const title = 'E2E cache identity ' + crypto.randomUUID();
  await page.getByLabel('Название *', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки').fill('REQ-880003');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();

  async function signInOutsideSpa(username: string) {
    const token = await (await page.request.get('/api/csrf')).json();
    expect((await page.request.post('/api/logout', { headers: { 'X-CSRF-TOKEN': token.token } })).status()).toBe(204);
    const anonymous = await (await page.request.get('/api/csrf')).json();
    expect((await page.request.post('/api/login', { headers: { 'X-CSRF-TOKEN': anonymous.token },
      form: { username, password: process.env.SI_DEMO_PASSWORD! } })).status()).toBe(204);
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session' && response.status() === 200);
    await context.setOffline(false); await refreshed;
    await expect(page.locator('.account')).toContainText(username);
  }
  await signInOutsideSpa('initiator.one');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await signInOutsideSpa('initiator.two');
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
});


test('UI-12: storage unavailability keeps the form, session and command key for a safe retry', async ({ page }) => {
  await login(page);
  const before = await (await page.request.get('/api/tasks')).json();
  const keys: string[] = [];
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) await route.fulfill({ status: 503, contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'SERVICE_UNAVAILABLE', status: 503, code: 'SERVICE_UNAVAILABLE' }) });
    else await route.continue();
  });
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  const title = 'E2E storage retry ' + crypto.randomUUID();
  await page.getByLabel('Название *', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки').fill('REQ-880003');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сервис временно недоступен. Повторите запрос позже');
  await expect(page.getByLabel('Название *', { exact: true })).toHaveValue(title);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect((await (await page.request.get('/api/tasks')).json()).totalItems).toBe(before.totalItems + 1);
});
