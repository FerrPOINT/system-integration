import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, waitForRegistry } from './support';
import { ApiSession } from '../support/http.mjs';

async function expectGaps(region: Locator) {
  const gaps = await region.evaluate(el => {
    const children = Array.from(el.children).filter(child => {
      const rect = child.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !['absolute', 'fixed'].includes(getComputedStyle(child).position);
    });
    return children.slice(1).map((child, index) => ({
      before: children[index].textContent?.trim().slice(0, 35),
      after: child.textContent?.trim().slice(0, 35),
      gap: child.getBoundingClientRect().top - children[index].getBoundingClientRect().bottom,
    }));
  });
  for (const item of gaps) {
    expect(item.gap, JSON.stringify(item)).toBeGreaterThanOrEqual(16);
    expect(item.gap, JSON.stringify(item)).toBeLessThanOrEqual(24);
  }
}

async function expectCards(page: Page) {
  for (const card of await page.locator('.base-card-content').all()) await expectGaps(card);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('UI-07: exchange loading, error, empty and ready states keep the filter separated', async ({ page, baseURL }, info) => {
  await login(page, 'operator');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let mode: 'loading' | 'error' | 'empty' | 'ready' = 'loading';
  await page.route('**/api/exchange/issues?*', async route => {
    if (mode === 'loading') await held;
    if (mode === 'error') await route.fulfill({ status: 502, contentType: 'text/html', body: 'Temporarily unavailable' });
    else if (mode === 'empty') await route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
    else await route.continue();
  });
  try {
    await page.goto('/issues?status=RESOLVED');
    await expect(page.getByRole('combobox', { name: 'Состояние разбора', exact: true })).toBeVisible();
    const pending = page.getByRole('status').filter({ hasText: 'Загрузка…' });
    await expect(pending).toBeVisible();
    await expect(page.locator('.pagination-footer')).toHaveText('');
    await expectGaps(page.locator('main'));
    await expect(pending).toHaveAttribute('aria-busy', 'true');
    await expect(pending.locator('.base-notice-icon')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('exchange-loading.png') });
    mode = 'error'; release();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectGaps(page.locator('main'));
    mode = 'empty';
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByText('Проблем в выбранном состоянии нет.', { exact: true })).toBeVisible();
    await expectGaps(page.locator('main'));
    mode = 'ready';
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.locator('[data-issue-link]').first()).toBeVisible();
    if (info.project.name === 'desktop') await expect(page.getByRole('table', { name: 'Реестр разборов обмена' })).toBeVisible();
    else await expect(page.getByRole('table')).toHaveCount(0);
    await expectGaps(page.locator('main'));
    await expectCards(page);
    await waitForRegistry(page);
    const readySize = new URL(page.url()).searchParams.get('size');
    const readyLinks = await page.locator('[data-issue-link]').evaluateAll(links => links.map(link => link.getAttribute('href')));
    mode = 'error';
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(new URL(page.url()).searchParams.get('size')).toBe(readySize);
    expect(await page.locator('[data-issue-link]').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(readyLinks);
    await expect(page.locator('[data-issue-link]').first()).toBeVisible();
    await expectGaps(page.locator('main'));
    mode = 'ready';
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('[data-issue-link]').first().click();
    await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
    await expectGaps(page.locator('main'));
    await expectCards(page);
    // A resolved issue may legitimately have no saved reconciliation. Own the
    // snapshot fixture instead of depending on whichever issue is newest.
    const initiator = new ApiSession(baseURL);
    await initiator.login('initiator.one', process.env.SI_DEMO_PASSWORD);
    const task = await initiator.command('POST', '/api/tasks', {
      title: 'E2E интервалы сверки ' + crypto.randomUUID(), request: { reference: 'REQ-870002', quantity: 25 },
    });
    await expect.poll(async () => (await initiator.get('/api/tasks/' + task.taskId)).businessStatus).toBe('SUCCEEDED');
    const { token } = await (await page.request.get('/api/csrf')).json();
    const saved = await page.request.post('/api/tasks/' + task.taskId + '/reconciliations', {
      headers: { 'X-CSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(saved.ok()).toBe(true);
    const snapshot = await saved.json();
    expect(snapshot.outcome).toBe('MATCH');
    await page.goto('/tasks/' + task.taskId + '/reconciliations/' + snapshot.reconciliationId);
    await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
    await expectGaps(page.locator('main'));
    await expectCards(page);
  } finally { mode = 'error'; release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('UI-08: task registry, editor, card and history use consistent section gaps', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks?*', async route => { await held; await route.continue(); });
  try {
    await login(page);
    await expect(page.getByRole('status').filter({ hasText: 'Загрузка…' })).toBeVisible();
    await expectGaps(page.locator('main'));
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  await waitForRegistry(page);
  const refresh=page.locator('.base-page-header').getByRole('button', { name: 'Обновить', exact: true });
  await expect(refresh).toBeVisible();
  await expect(refresh).toHaveAttribute('title','Обновить');
  await expect(refresh).toHaveText('');
  await expect(refresh.locator('svg')).toHaveCount(1);
  await expectGaps(page.locator('main'));
  await expectCards(page);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новое задание', exact: true })).toBeVisible();
  await expectGaps(page.locator('main'));
  await expectCards(page);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.locator('.task-card h2 a, .task-table tbody a').first().click();
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
  await expect(page.locator('.base-timeline')).toBeVisible();
  await expectGaps(page.locator('main'));
  await expectCards(page);
});
