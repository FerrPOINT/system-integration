import { test, expect, type Page, type Locator } from '@playwright/test';
import { login } from './support';

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

test('UI-07: exchange loading, error, empty and ready states keep the filter separated', async ({ page }, info) => {
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
    await expect(page.locator('.issue-cards')).toBeVisible();
    await expectGaps(page.locator('main'));
    await expectCards(page);
    mode = 'error';
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.issue-cards')).toBeVisible();
    await expectGaps(page.locator('main'));
    mode = 'ready';
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.locator('.issue-cards h2 a').first().click();
    await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
    await expectGaps(page.locator('main'));
    await expectCards(page);
    await page.getByRole('link', { name: 'Открыть последнюю сверку', exact: true }).click();
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
  await expect(page.locator('.list-heading')).toBeVisible();
  await expectGaps(page.locator('main'));
  await expectCards(page);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новое задание', exact: true })).toBeVisible();
  await expectGaps(page.locator('main'));
  await expectCards(page);
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await page.locator('.task-card h2 a, .task-table tbody a').first().click();
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
  await expect(page.locator('.base-timeline')).toBeVisible();
  await expectGaps(page.locator('main'));
  await expectCards(page);
});
