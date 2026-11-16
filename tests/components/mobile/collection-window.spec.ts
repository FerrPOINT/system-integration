import { expect, test, type Page } from '@playwright/test';

type WindowInfo = { pages: number[]; cached: number; fetching: boolean };
type Fixture = { fixtureCollectionInfo: () => WindowInfo; fixtureEvictInactiveLists: () => void };
const info = (page: Page) => page.evaluate(() => (window as unknown as Fixture).fixtureCollectionInfo());
const owner = '00000000-0000-4000-8000-000000000003';
const id = (sequence: number) => '10000000-0000-4000-8000-' + String(sequence).padStart(12, '0');

async function server(page: Page, total: number, history = false) {
  const state = {
    total,
    front: 0,
    deleted: new Set<number>(),
    reads: [] as number[],
    fail: undefined as number | undefined,
  };
  function task(sequence: number) {
    const request = { reference: 'REQ-' + String(sequence % 1_000_000).padStart(6, '0'), quantity: 25 };
    return {
      taskId: id(sequence),
      operationId: id(sequence),
      ownerId: owner,
      title: 'Запись №' + sequence,
      titleRevision: 1,
      request,
      createdAt: '2026-11-14T00:00:00Z',
      deliveryStatus: 'ACKNOWLEDGED',
      businessStatus: 'SUCCEEDED',
      result: {
        operationId: id(sequence),
        request,
        version: 2,
        status: 'SUCCEEDED',
        completedAt: '2026-11-14T00:00:00Z',
      },
    };
  }
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') throw new Error('Window fixture forbids writes');
      if (url.pathname === '/api/session')
        return route.fulfill({
          json: { userId: owner, username: 'fixture', role: history ? 'OPERATOR' : 'INITIATOR' },
        });
      if (!history && url.pathname.endsWith('/history'))
        return route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
      if (history ? url.pathname.endsWith('/history') : url.pathname === '/api/tasks') {
        const number = Number(url.searchParams.get('page') ?? 0);
        const size = Number(url.searchParams.get('size'));
        state.reads.push(number);
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (state.fail === number) return route.fulfill({ status: 502, body: '<html>Read failed</html>' });
        const count = state.total + state.front - state.deleted.size;
        const items = [];
        let visible = 0;
        for (let index = 0; index < state.total + state.front && items.length < size; index++) {
          const sequence = 1_000_000 + state.front - index;
          if (state.deleted.has(sequence)) continue;
          if (visible++ >= number * size)
            items.push(
              history
                ? {
                    eventId: id(sequence),
                    taskId: id(1_000_000),
                    operationId: id(1_000_000),
                    occurredAt: '2026-11-14T00:00:00Z',
                    actor: 'USER',
                    actorUserId: owner,
                    type: 'RECONCILED',
                    summary: 'Событие №' + sequence,
                    reconciliationId: id(sequence),
                  }
                : task(sequence),
            );
        }
        return route.fulfill({
          json: {
            items,
            page: number,
            hasNext: (number + 1) * size < count,
            totalItems: count,
            totalPages: Math.ceil(count / size),
          },
        });
      }
      if (url.pathname.includes('/reconciliations/'))
        return route.fulfill({
          json: {
            reconciliationId: url.pathname.split('/').at(-1),
            taskId: id(1_000_000),
            operationId: id(1_000_000),
            checkedAt: '2026-11-14T00:00:00Z',
            checkedBy: owner,
            outcome: 'UNAVAILABLE',
            externalAvailability: 'UNAVAILABLE',
            local: { request: task(1_000_000).request, deliveryStatus: 'ACKNOWLEDGED', businessStatus: 'SUCCEEDED' },
          },
        });
      if (url.pathname.startsWith('/api/tasks/'))
        return route.fulfill({ json: task(Number(url.pathname.split('/').at(-1)!.slice(-12))) });
      throw new Error('Unexpected window fixture request: ' + url.pathname);
    },
  );
  return state;
}

async function ready(page: Page, history = false) {
  await expect(page.getByRole('heading', { name: history ? 'История' : 'Мои задания', exact: true })).toBeVisible();
  await expect(page.locator(history ? '.history-panel .paged-list' : 'section.paged-list')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect.poll(async () => (await info(page)).fetching).toBe(false);
}
async function forward(page: Page, history = false) {
  const previous = (await info(page)).pages.at(-1)!;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => (await info(page)).pages.at(-1)).toBeGreaterThan(previous);
  await ready(page, history);
}
async function visibleAnchor(page: Page) {
  return page.locator('.task-cards [data-record-id]').evaluateAll((rows) => {
    const row = rows.find((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }) as HTMLElement;
    if (!row) throw new Error('No fully visible row');
    return { id: row.dataset.recordId!, top: row.getBoundingClientRect().top };
  });
}

test('new history entry starts at page zero while native Back restores the old anchor', async ({ page }) => {
  await server(page, 1000, true);
  await page.goto('/tests/collection-window.html?history');
  await ready(page, true);
  for (let count = 0; count < 7; count++) await forward(page, true);
  expect((await info(page)).pages[0]).toBeGreaterThan(0);
  const anchor = await page.locator('.history-panel [data-record-id]').evaluateAll((rows) => {
    const row = rows.find(
      (row) => row.getBoundingClientRect().top >= 0 && row.getBoundingClientRect().bottom <= innerHeight,
    ) as HTMLElement;
    return { id: row.dataset.recordId!, top: row.getBoundingClientRect().top };
  });
  const row = page.locator('[data-record-id="' + anchor.id + '"]');
  await row.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await page.goBack();
  await ready(page, true);
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - anchor.top)).toBeLessThan(2);
  await row.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'К заданию', exact: true }).click();
  await ready(page, true);
  await expect.poll(async () => (await info(page)).pages[0]).toBe(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Запись №1000000', exact: true })).toBeVisible();
  await expect(page.locator('[data-record-id="' + id(1_000_000) + '"]')).toBeAttached();
  expect((await info(page)).cached).toBeLessThanOrEqual(100);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await page.goBack();
  await ready(page, true);
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - anchor.top)).toBeLessThan(2);
});

for (const total of [20, 100, 1000, 5000]) {
  test(`window budget, refetch and backward access with ${total} records`, async ({ page }) => {
    const state = await server(page, total);
    await page.goto('/tests/collection-window.html');
    await ready(page);
    const target = Math.min(11, Math.ceil(total / 20) - 1);
    while ((await info(page)).pages.at(-1)! < target) {
      await forward(page);
      expect((await info(page)).cached).toBeLessThanOrEqual(100);
      expect(await page.locator('.task-cards [data-record-id]').count()).toBeLessThanOrEqual(100);
    }
    const loaded = (await info(page)).pages.length;
    state.reads.length = 0;
    await page
      .getByRole('button', { name: 'Обновить', exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(() => state.reads.length).toBe(loaded);
    await ready(page);
    expect(loaded).toBeLessThanOrEqual(5);
    while ((await info(page)).pages[0] > 0) {
      const first = (await info(page)).pages[0];
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(async () => (await info(page)).pages[0]).toBeLessThan(first);
      await ready(page);
    }
    await expect(page.locator('[data-record-id="' + id(1_000_000) + '"]')).toBeAttached();
    expect((await info(page)).cached).toBeLessThanOrEqual(100);
  });
}

test('failed restoration keeps its read error and waits for an explicit retry', async ({ page }) => {
  const state = await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  for (let count = 0; count < 7; count++) await forward(page);
  const anchor = await visibleAnchor(page);
  await page.locator('[data-record-id="' + anchor.id + '"] .mobile-card-link').click();
  await expect(page.getByRole('heading', { name: 'Состояние задания', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(
      (key) => key.startsWith('system-integration.feed-position.') && key.includes('/tasks'),
    )!;
    return JSON.parse(sessionStorage.getItem(key)!).position as { page: number };
  });
  state.fail = saved.page;
  state.reads.length = 0;
  await page.evaluate(() => (window as unknown as Fixture).fixtureEvictInactiveLists());
  await page.goBack();
  await ready(page);
  const retry = page.getByRole('button', { name: 'Повторить загрузку', exact: true });
  await retry.scrollIntoViewIfNeeded();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Не удалось восстановить позицию. Повторите загрузку.', { exact: true })).toBeVisible();
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, 100);
  expect(state.reads.filter((number) => number === saved.page)).toHaveLength(1);
  state.fail = undefined;
  await retry.click();
  await ready(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('unavailable position storage is explicit and leaves ordinary paging usable', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('system-integration.feed-position.')) throw new DOMException('Denied', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('system-integration.feed-position.')) throw new DOMException('Denied', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  await forward(page);
  await expect(page.getByText('Браузер не сохраняет позицию списка.', { exact: true })).toBeAttached();
  expect((await info(page)).cached).toBe(40);
});

test('return restores the visible record after inactive query data is evicted', async ({ page }) => {
  await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  for (let count = 0; count < 8; count++) await forward(page);
  const anchor = await visibleAnchor(page);
  await page.locator('[data-record-id="' + anchor.id + '"] .mobile-card-link').click();
  await expect(page.getByRole('heading', { name: 'Состояние задания', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as Fixture).fixtureEvictInactiveLists());
  expect((await info(page)).cached).toBe(0);
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await ready(page);
  const row = page.locator('[data-record-id="' + anchor.id + '"]');
  await expect(row).toBeVisible();
  await expect.poll(async () => Math.abs((await row.boundingBox())!.y - anchor.top)).toBeLessThan(2);
  expect((await info(page)).cached).toBeLessThanOrEqual(100);
  expect((await info(page)).pages[0]).toBeGreaterThan(0);
});

test('refetch with a concurrent insertion preserves the visible record and offset', async ({ page }) => {
  const state = await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  for (let count = 0; count < 7; count++) await forward(page);
  const anchor = await visibleAnchor(page);
  state.front = 1;
  await page
    .getByRole('button', { name: 'Обновить', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText('Всего: 1001', { exact: true })).toBeVisible();
  await ready(page);
  await expect
    .poll(async () =>
      Math.abs((await page.locator('[data-record-id="' + anchor.id + '"]').boundingBox())!.y - anchor.top),
    )
    .toBeLessThan(2);
});

test('a large concurrent shift reports the unavailable anchor and keeps older records accessible', async ({ page }) => {
  const state = await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  for (let count = 0; count < 7; count++) await forward(page);
  const anchor = await visibleAnchor(page);
  state.front = 120;
  await page
    .getByRole('button', { name: 'Обновить', exact: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByText('Всего: 1120', { exact: true })).toBeVisible();
  await ready(page);
  await expect(page.locator('[data-record-id="' + anchor.id + '"]')).toHaveCount(0);
  await expect(
    page.getByText('Список изменился. Позиция восстановлена по доступным записям.', { exact: true }),
  ).toBeAttached();
  expect((await info(page)).cached).toBeLessThanOrEqual(100);
  for (let count = 0; count < 6; count++) await forward(page);
  await expect(page.locator('[data-record-id="' + anchor.id + '"]')).toBeAttached();
  expect((await info(page)).cached).toBeLessThanOrEqual(100);
});

test('both paging directions stop after an error and retry only the failed read', async ({ page }) => {
  const state = await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  state.fail = 1;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const next = page.getByRole('button', { name: 'Повторить загрузку', exact: true });
  await expect(next).toBeVisible();
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => state.reads.filter((number) => number === 1).length).toBe(1);
  expect((await info(page)).cached).toBe(20);
  state.fail = undefined;
  await next.click();
  await ready(page);
  for (let count = 0; count < 6; count++) await forward(page);
  const previous = (await info(page)).pages[0] - 1;
  state.fail = previous;
  state.reads.length = 0;
  await page.evaluate(() => window.scrollTo(0, 0));
  const retry = page.getByRole('button', { name: 'Повторить загрузку предыдущих записей', exact: true });
  await expect(retry).toBeVisible();
  await page.mouse.wheel(0, 100);
  await page.mouse.wheel(0, -100);
  expect(state.reads).toEqual([previous]);
  expect((await info(page)).cached).toBe(100);
  state.fail = undefined;
  await retry.click();
  await ready(page);
  await expect.poll(async () => (await info(page)).pages[0]).toBe(previous);
});

test('deleted anchor and a shortened list restore an available area with an explicit notice', async ({ page }) => {
  const state = await server(page, 1000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  for (let count = 0; count < 7; count++) await forward(page);
  const anchor = await visibleAnchor(page);
  await page.locator('[data-record-id="' + anchor.id + '"] .mobile-card-link').click();
  await expect(page.getByRole('heading', { name: 'Состояние задания', exact: true })).toBeVisible();
  state.deleted.add(Number(anchor.id.slice(-12)));
  await page.evaluate(() => (window as unknown as Fixture).fixtureEvictInactiveLists());
  await page.goBack();
  await ready(page);
  await expect(
    page.getByText('Список изменился. Позиция восстановлена по доступным записям.', { exact: true }),
  ).toBeVisible();
  expect((await info(page)).cached).toBeLessThanOrEqual(100);
  const nextAnchor = await visibleAnchor(page);
  await page.locator('[data-record-id="' + nextAnchor.id + '"] .mobile-card-link').click();
  await expect(page.getByRole('heading', { name: 'Состояние задания', exact: true })).toBeVisible();
  state.total = 15;
  state.deleted.clear();
  await page.evaluate(() => (window as unknown as Fixture).fixtureEvictInactiveLists());
  await page.goBack();
  await ready(page);
  await expect(page.locator('.task-cards [data-record-id]')).toHaveCount(15);
  await expect(page.getByText('Список изменился. Он открыт сначала.', { exact: true })).toBeVisible();
  expect((await info(page)).pages).toEqual([0]);
});

test('an unusually tall mobile viewport reaches the end without sentinel oscillation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 2600 });
  const state = await server(page, 100);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  while ((await info(page)).pages.at(-1)! < 4) await forward(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('[data-feed-end]')).toHaveText('1–100 из 100');
  // StrictMode may cancel the initial GET; automatic next pages still load once.
  expect(state.reads.filter((number) => number === 0).length).toBeLessThanOrEqual(2);
  expect(state.reads.filter((number) => number > 0)).toEqual([1, 2, 3, 4]);
  expect((await info(page)).cached).toBe(100);
});

test('a stable 5000-record collection is traversable without gaps or duplicates in bounded windows', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const state = await server(page, 5000);
  await page.goto('/tests/collection-window.html');
  await ready(page);
  expect(state.reads.every((number) => number === 0)).toBe(true);
  expect(state.reads.length).toBeLessThanOrEqual(2);
  state.reads.length = 0;
  const seen = new Set<string>();
  for (;;) {
    for (const value of await page
      .locator('.task-cards [data-record-id]')
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.recordId!)))
      seen.add(value);
    const window = await info(page);
    expect(window.cached).toBeLessThanOrEqual(100);
    if (window.pages.at(-1) === 249) break;
    await forward(page);
  }
  expect(seen.size).toBe(5000);
  expect(state.reads).toEqual(Array.from({ length: 249 }, (_, index) => index + 1));
  await expect(page.locator('[data-record-id="' + id(995001) + '"]')).toBeAttached();
});

for (const total of [20, 100, 1000, 5000]) {
  test(`history polling retains a bounded window with ${total} events`, async ({ page }) => {
    const state = await server(page, total, true);
    await page.clock.install();
    await page.goto('/tests/collection-window.html?history');
    await ready(page, true);
    const target = Math.min(7, Math.ceil(total / 20) - 1);
    while ((await info(page)).pages.at(-1)! < target) await forward(page, true);
    const loaded = (await info(page)).pages.length;
    const anchor = await page.locator('.history-panel [data-record-id]').evaluateAll((rows) => {
      const row = rows.find(
        (row) => row.getBoundingClientRect().top >= 0 && row.getBoundingClientRect().bottom <= innerHeight,
      ) as HTMLElement;
      return { id: row.dataset.recordId!, top: row.getBoundingClientRect().top };
    });
    state.reads.length = 0;
    await page.clock.fastForward(10_000);
    await expect.poll(() => state.reads.length).toBe(loaded);
    await ready(page, true);
    expect(loaded).toBeLessThanOrEqual(5);
    expect((await info(page)).cached).toBeLessThanOrEqual(100);
    expect(await page.locator('.history-panel [data-record-id]').count()).toBeLessThanOrEqual(100);
    await expect
      .poll(async () =>
        Math.abs((await page.locator('[data-record-id="' + anchor.id + '"]').boundingBox())!.y - anchor.top),
      )
      .toBeLessThan(2);
  });
}
