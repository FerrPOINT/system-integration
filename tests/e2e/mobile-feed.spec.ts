import { test, expect } from '@playwright/test';
import type { Task } from '../../frontend/build/generated/openapi/client';
import { login, selectChoice, waitForRegistry } from './support';

test('UI-19: mobile feed appends once, retains cards on failure, retries and resets with filters', async ({ page }) => {
  await login(page);
  const { token } = await (await page.request.get('/api/csrf')).json();
  const created = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: 'E2E mobile feed', request: { reference: 'REQ-890001', quantity: 25 } },
  });
  expect(created.status()).toBe(201);
  const receipt = await created.json();
  const source: Task = await (await page.request.get('/api/tasks/' + receipt.taskId)).json();
  const items = Array.from({ length: 45 }, (_, index) => ({
    ...source,
    taskId: crypto.randomUUID(),
    title: 'Запись ленты ' + index,
  }));
  const requests: { page: number; size: number; status: string | null }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route('**/api/tasks?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const window = {
      page: Number(query.get('page')),
      size: Number(query.get('size')),
      status: query.get('businessStatus'),
    };
    requests.push(window);
    if (window.page === 1 && fail) {
      await held;
      await route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', status: 503 } });
      return;
    }
    const matching = window.status ? items.slice(0, 2).map((item) => ({ ...item, businessStatus: 'REJECTED' })) : items;
    await route.fulfill({
      json: {
        items: matching.slice(window.page * window.size, (window.page + 1) * window.size),
        page: window.page,
        hasNext: (window.page + 1) * window.size < matching.length,
        totalItems: matching.length,
        totalPages: Math.ceil(matching.length / window.size),
      },
    });
  });
  try {
    await page.goto('/tasks?createdFrom=2026-01-01T00%3A00%3A00Z&size=2&page=7');
    await waitForRegistry(page);
    await expect(page).not.toHaveURL(/size=|page=/);
    const cards = page.locator('.task-cards > li');
    const footer = page.locator('[data-feed-end]');
    await expect(cards).toHaveCount(20);
    await expect(page.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('status')).toContainText('Загружаем ещё');
    await page.mouse.wheel(0, 150);
    expect(requests.filter((window) => window.page === 1)).toHaveLength(1);
    release();
    await expect(footer.getByRole('alert')).toBeVisible();
    await expect(cards).toHaveCount(20);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, 100);
    expect(requests.filter((window) => window.page === 1)).toHaveLength(1);
    fail = false;
    await footer.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await expect(cards).toHaveCount(40);
    await footer.scrollIntoViewIfNeeded();
    await expect(cards).toHaveCount(45);
    await expect(footer).toHaveText('Показано 45 из 45');
    const hrefs = await cards.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs).toEqual(items.map((item) => '/tasks/' + item.taskId));
    expect(requests.map((window) => window.page)).toEqual([0, 1, 1, 2]);
    expect(requests.every((window) => window.size === 20)).toBe(true);

    // A whole card is a native link; both browser Back and the detail arrow keep the feed and position.
    const target = items[25];
    await page.route('**/api/tasks/' + target.taskId, (route) => route.fulfill({ json: target }));
    await page.route('**/api/tasks/' + target.taskId + '/history?*', (route) =>
      route.fulfill({
        json: {
          items: [],
          page: 0,
          hasNext: false,
          totalItems: 0,
          totalPages: 0,
        },
      }),
    );
    const link = page.getByRole('link', { name: target.title, exact: true });
    await link.scrollIntoViewIfNeeded();
    const offset = await page.evaluate(() => scrollY);
    for (const arrow of [false, true]) {
      await link.click();
      await expect(page.locator('main h1')).toHaveText(target.title);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      expect((await page.locator('main h1').boundingBox())!.width).toBeGreaterThan(page.viewportSize()!.width - 40);
      if (arrow) await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
      else await page.goBack();
      await expect(cards).toHaveCount(45);
      expect(new URL(page.url()).searchParams.get('createdFrom')).toBe('2026-01-01T00:00:00Z');
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(offset, 0);
    }
    await page.getByRole('button', { name: 'Фильтры заданий', exact: true }).click();
    await selectChoice(page, 'Результат', 'Отклонено');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(cards).toHaveCount(2);
    await expect(footer).toHaveText('Показано 2 из 2');
    expect(requests.at(-1)).toEqual({ page: 0, size: 20, status: 'REJECTED' });
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('UI-19: narrow phones use one scroll surface and compact, accessible controls', async ({ page }) => {
  await login(page, 'operator');
  for (const [width, height] of [
    [320, 568],
    [348, 672],
    [390, 844],
    [390, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await waitForRegistry(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const metrics = await page.evaluate(() => {
      const header = document.querySelector('.app-header')!.getBoundingClientRect();
      const tools = document.querySelector('.list-tools')!.getBoundingClientRect();
      const card = document.querySelector('[data-page-item]')!.getBoundingClientRect();
      return {
        header: header.height,
        tools: tools.height,
        card: card.height,
        nested: [...document.querySelectorAll('main,.paged-viewport,.list-tools')].some(
          (element) => element.scrollHeight > element.clientHeight + 1,
        ),
        controls: [...document.querySelectorAll('.app-header button,.list-tools button')].every(
          (element) => element.getBoundingClientRect().width >= 44,
        ),
      };
    });
    expect(metrics.header).toBeLessThanOrEqual(125);
    expect(metrics.tools).toBeLessThanOrEqual(70);
    expect(metrics.card).toBeLessThanOrEqual(125);
    expect(metrics.nested).toBe(false);
    expect(metrics.controls).toBe(true);
    await page.getByRole('button', { name: 'Меню приложения', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Меню приложения', exact: true });
    await expect(menu.getByRole('combobox', { name: 'Цветовая тема', exact: true })).toBeVisible();
    await expect(menu).toContainText('operator');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Меню приложения', exact: true })).toBeFocused();
  }
});
