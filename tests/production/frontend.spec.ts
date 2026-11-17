import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from '../e2e/support';

const taskId = '10000000-0000-4000-8000-000000000001';
const snapshotId = '10000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000003';
const input = { reference: 'REQ-123456', quantity: 25 };
const task = {
  taskId,
  operationId: taskId,
  ownerId: userId,
  title: 'Production UI task',
  titleRevision: 1,
  request: input,
  createdAt: '2026-11-16T00:00:00Z',
  deliveryStatus: 'ACKNOWLEDGED',
  businessStatus: 'SUCCEEDED',
  result: { status: 'SUCCEEDED', completedAt: '2026-11-16T00:00:00Z' },
};
async function mockApi(
  page: Page,
  role = 'INITIATOR',
  historyCount = 0,
  control: {
    failTasks?: boolean;
    failHistory?: boolean;
    totalTasks?: number;
    signedIn?: boolean;
    technicalHistory?: boolean;
    historyActions?: boolean;
    tallHistoryFrom?: number;
  } = {},
) {
  const reads: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      reads.push(url.pathname + url.search);
      if (url.pathname === '/api/session')
        return route.fulfill({
          status: control.signedIn === false ? 401 : 200,
          json:
            control.signedIn === false
              ? { code: 'SESSION_REQUIRED' }
              : { userId, username: 'production-fixture', role },
        });
      if (url.pathname === '/api/tasks') {
        if (control.failTasks) return route.fulfill({ status: 502, json: { code: 'SERVICE_UNAVAILABLE' } });
        const size = Number(url.searchParams.get('size') ?? 20),
          pageNumber = Number(url.searchParams.get('page') ?? 0);
        const from = url.searchParams.get('createdFrom'),
          to = url.searchParams.get('createdTo');
        const status = url.searchParams.get('businessStatus');
        const total =
          (status && status !== task.businessStatus) ||
          (from && Date.parse(task.createdAt) < Date.parse(from)) ||
          (to && Date.parse(task.createdAt) >= Date.parse(to))
            ? 0
            : (control.totalTasks ?? 1000);
        return route.fulfill({
          json: {
            items: Array.from({ length: Math.min(size, Math.max(0, total - pageNumber * size)) }, (_, n) => {
              const id = '10000000-0000-4000-8000-' + String(100 + pageNumber * size + n).padStart(12, '0');
              return { ...task, taskId: id, operationId: id };
            }),
            page: pageNumber,
            totalItems: total,
            totalPages: Math.ceil(total / size),
            hasNext: (pageNumber + 1) * size < total,
          },
        });
      }
      if (url.pathname.endsWith('/history')) {
        if (control.failHistory) return route.fulfill({ status: 502, json: { code: 'SERVICE_UNAVAILABLE' } });
        const pageNumber = Number(url.searchParams.get('page') ?? 0),
          size = Number(url.searchParams.get('size') ?? 20);
        return route.fulfill({
          json: {
            items: Array.from({ length: Math.min(size, Math.max(0, historyCount - pageNumber * size)) }, (_, n) => ({
              eventId: '10000000-0000-4000-8000-' + String(1000 + pageNumber * size + n).padStart(12, '0'),
              taskId,
              operationId: taskId,
              occurredAt: task.createdAt,
              actor: 'SYSTEM',
              type: control.technicalHistory ? 'DELIVERY_ATTEMPT' : 'CREATED',
              summary: control.technicalHistory
                ? 'Попытка ' + (pageNumber * size + n + 1) + ': PUT'
                : 'History event ' + (pageNumber * size + n),
              ...(control.tallHistoryFrom !== undefined && pageNumber * size + n >= control.tallHistoryFrom
                ? {
                    summary:
                      'History event ' + (pageNumber * size + n) + '. ' + 'Подробное описание обмена. '.repeat(16),
                  }
                : {}),
              ...(control.historyActions && pageNumber * size + n === 0
                ? {
                    actor: 'USER',
                    actorUserId: userId,
                    actorUsername: 'operator',
                    type: 'RECONCILED',
                    summary: 'Сверка обнаружила расхождение',
                    reconciliationId: snapshotId,
                    issueId: taskId,
                  }
                : {}),
            })),
            page: pageNumber,
            totalItems: historyCount,
            totalPages: Math.ceil(historyCount / size),
            hasNext: (pageNumber + 1) * size < historyCount,
          },
        });
      }
      if (url.pathname === '/api/tasks/' + taskId) return route.fulfill({ json: task });
      if (url.pathname === '/api/exchange/issues/' + taskId)
        return route.fulfill({
          json: {
            issueId: taskId,
            taskId,
            operationId: taskId,
            taskTitle: task.title,
            requestReference: input.reference,
            issueRevision: 1,
            kind: 'RECONCILIATION_DIFFERENCE',
            status: 'RESOLVED',
            summary: 'Проверенное расхождение',
            openedAt: task.createdAt,
            assignedTo: userId,
            allowedActions: [],
            latestReconciliationId: snapshotId,
            evidence: {
              reason: 'Диагностика исходного расхождения',
              local: { request: input, deliveryStatus: task.deliveryStatus, businessStatus: task.businessStatus },
              received: {
                operationId: taskId,
                request: input,
                version: 2,
                status: 'SUCCEEDED',
                completedAt: task.createdAt,
              },
            },
            resolution: {
              issueId: taskId,
              action: 'ACKNOWLEDGE_DIFFERENCE',
              reason: 'Проверка завершена. Локальное состояние согласовано с ответственным оператором. '.repeat(6),
              reconciliationId: snapshotId,
              decidedAt: task.createdAt,
              decidedBy: userId,
            },
          },
        });
      if (url.pathname === `/api/tasks/${taskId}/reconciliations/${snapshotId}`)
        return route.fulfill({
          json: {
            reconciliationId: snapshotId,
            taskId,
            operationId: taskId,
            checkedAt: task.createdAt,
            checkedBy: userId,
            outcome: 'UNAVAILABLE',
            externalAvailability: 'UNAVAILABLE',
            local: { request: input, deliveryStatus: task.deliveryStatus, businessStatus: task.businessStatus },
          },
        });
      throw new Error('Unexpected production fixture API: ' + url.pathname);
    },
  );
  return reads;
}

test('failed task refetch retains the measured window and does not retry through size changes @desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.install();
  const control = { failTasks: false };
  const reads = await mockApi(page, 'INITIATOR', 0, control);
  await page.goto('/tasks?businessStatus=SUCCEEDED');
  await expect(page).toHaveURL(/size=3/);
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  const originalRows = await rows.allTextContents();
  const originalUrl = page.url();
  const count = reads.filter((read) => read.startsWith('/api/tasks?')).length;
  control.failTasks = true;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  // Let measurement frames run; no manual retry or focus event occurs in this interval.
  await page.clock.runFor(1000);
  expect(page.url()).toBe(originalUrl);
  expect(await rows.allTextContents()).toEqual(originalRows);
  expect(reads.filter((read) => read.startsWith('/api/tasks?'))).toHaveLength(count + 1);
  control.failTasks = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(3);
  expect(new URL(page.url()).searchParams.get('businessStatus')).toBe('SUCCEEDED');
});

test('task history exposes descriptions and adapts the left pane to viewport height', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 720 });
  await mockApi(page, 'INITIATOR', 1000, { technicalHistory: true });
  await page.goto('/tasks/' + taskId);
  const history = page.getByRole('region', { name: 'История', exact: true });
  const state = page.getByRole('region', { name: 'Состояние задания', exact: true });
  await expect(history.getByText('Попытка 1: PUT', { exact: true })).toBeVisible();
  await expect(history.locator('details')).toHaveCount(0);
  if (info.project.name === 'mobile') {
    await expect(page).not.toHaveURL(/size=/);
    await expect(history.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
    const stateBox = (await state.boundingBox())!,
      historyBox = (await history.boundingBox())!;
    expect(historyBox.y).toBeGreaterThanOrEqual(stateBox.y + stateBox.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    return;
  }
  async function settledSize() {
    await expect
      .poll(async () => {
        const size = Number(new URL(page.url()).searchParams.get('size'));
        return (
          (await history.locator('[data-event-id]').count()) === size &&
          (await history.locator('[aria-busy]').getAttribute('aria-busy')) === 'false'
        );
      })
      .toBe(true);
    return Number(new URL(page.url()).searchParams.get('size'));
  }
  async function fits() {
    await expect
      .poll(() =>
        history.evaluate((panel) => {
          const content = panel.querySelector('.ui-card-content')!,
            viewport = panel.querySelector('.paged-viewport')!;
          const footer = panel.querySelector('.pagination-footer')!.getBoundingClientRect();
          const area = viewport.getBoundingClientRect(),
            box = panel.getBoundingClientRect();
          const workspace = panel.closest('.task-workspace')!.getBoundingClientRect();
          const summary = document.querySelector('.task-summary')!.getBoundingClientRect();
          const rows = [...panel.querySelectorAll('[data-event-id]')];
          return {
            historyFirst: box.right <= summary.left && Math.abs(box.top - summary.top) < 1,
            fillsColumn: Math.abs(box.bottom - workspace.bottom) < 1,
            footerAtBottom:
              Math.abs(
                content.getBoundingClientRect().bottom -
                  parseFloat(getComputedStyle(content).paddingBottom) -
                  footer.bottom,
              ) < 1,
            visibleFooter: footer.bottom <= innerHeight && area.bottom <= footer.top,
            fittingRows:
              rows.every((row) => row.getBoundingClientRect().bottom <= area.bottom + 1) ||
              (rows.length === 1 && viewport.scrollHeight > viewport.clientHeight),
            noOverflow:
              document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
              document.querySelector('main')!.scrollTop === 0,
          };
        }),
      )
      .toEqual({
        historyFirst: true,
        fillsColumn: true,
        footerAtBottom: true,
        visibleFooter: true,
        fittingRows: true,
        noOverflow: true,
      });
  }
  await expect(page).toHaveURL(/size=/);
  await fits();
  const short = await settledSize();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(short);
  const tall = await settledSize();
  expect(tall).toBeGreaterThan(short);
  await fits();
  await page.setViewportSize({ width: 820, height: 480 });
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeLessThan(tall);
  expect(await settledSize()).toBeLessThan(tall);
  await fits();
  await history.getByRole('button', { name: 'Далее →', exact: true }).click();
  await expect(page).toHaveURL(/page=1/);
  await settledSize();
  await fits();
});

test('mixed-height history fits all nine entries and separates the two event links', async ({ page }, info) => {
  const desktop = info.project.name === 'desktop';
  await page.setViewportSize(desktop ? { width: 1513, height: 1243 } : { width: 320, height: 720 });
  await mockApi(page, 'OPERATOR', 9, { technicalHistory: true, historyActions: true });
  await page.goto('/tasks/' + taskId + '?size=8&page=0');
  const history = page.getByRole('region', { name: 'История', exact: true });
  const event = history.locator('[data-page-item]').filter({
    has: page.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true }),
  });
  const reconciliation = event.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true });
  const issue = event.getByRole('link', { name: 'Открыть разбор', exact: true });
  await expect(reconciliation).toHaveAttribute('href', '/tasks/' + taskId + '/reconciliations/' + snapshotId);
  await expect(issue).toHaveAttribute('href', '/issues/' + taskId);

  const first = (await reconciliation.boundingBox())!;
  const second = (await issue.boundingBox())!;
  const gap = second.y >= first.y + first.height ? second.y - first.y - first.height : second.x - first.x - first.width;
  expect.soft(gap).toBeGreaterThanOrEqual(6);
  await expect(history.locator('[data-page-item]')).toHaveCount(9);
  if (desktop) {
    await expect(history.getByText('Всего: 9', { exact: true })).toBeVisible();
    expect(
      await history
        .locator('.paged-viewport')
        .evaluate((viewport) => viewport.scrollHeight <= viewport.clientHeight + 1),
    ).toBe(true);
  } else {
    await expect(history.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
  }
});

test('history page boundaries stay fixed when a later page has taller events @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const total = 35;
  await mockApi(page, 'OPERATOR', total, { tallHistoryFrom: 6 });
  await page.goto('/tasks/' + taskId + '?size=5&page=0');
  const history = page.getByRole('region', { name: 'История', exact: true });
  const viewport = history.locator('.paged-viewport');
  const events = history.locator('[data-page-item]');
  const search = () => new URL(page.url()).searchParams;
  const next = history.getByRole('button', { name: 'Далее →', exact: true });
  await expect(next).toBeEnabled();
  await expect.poll(() => Number(search().get('size'))).toBe(6);
  await expect(events).toHaveCount(6);
  await expect(next).toBeEnabled();

  await next.click();
  await expect(events.first()).toContainText('History event 6.');
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(search().get('size')).toBe('6');
  expect(search().get('page')).toBe('1');
  await expect(events).toHaveCount(6);
  await expect(history.getByText('7–12 из 35', { exact: true })).toBeVisible();
  await expect(history.getByRole('button', { name: 'Страница 6', exact: true })).toBeVisible();
  await events.last().scrollIntoViewIfNeeded();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await history.getByRole('button', { name: 'Страница 6', exact: true }).click();
  await expect(events.first()).toContainText('History event 30.');
  await expect(history.getByText('31–35 из 35', { exact: true })).toBeVisible();
  await expect(events).toHaveCount(5);
  await expect(next).toBeDisabled();
  expect(search().get('size')).toBe('6');

  await history.getByRole('button', { name: 'Страница 1', exact: true }).click();
  await expect(history.getByText('1–6 из 35', { exact: true })).toBeVisible();
  expect(search().get('size')).toBe('6');
});

test('failed history polling retains its window and the next ordinary poll can recover @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.install();
  const control = { failHistory: false };
  const reads = await mockApi(page, 'INITIATOR', 50, control);
  await page.goto('/tasks/' + taskId);
  const events = page.locator('[data-event-id]');
  await expect.poll(() => events.count()).toBeGreaterThan(0);
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeLessThan(20);
  // A new size in the URL precedes its response; freeze the baseline only after that window is rendered.
  await expect
    .poll(async () => {
      const size = Number(new URL(page.url()).searchParams.get('size'));
      return (
        (await events.count()) === size &&
        (await page
          .getByRole('region', { name: 'История', exact: true })
          .locator('[aria-busy]')
          .getAttribute('aria-busy')) === 'false'
      );
    })
    .toBe(true);
  const originalUrl = page.url();
  const originalEvents = await events.allTextContents();
  const count = reads.filter((read) => read.includes('/history?')).length;
  control.failHistory = true;
  await page.clock.fastForward(10_000);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.clock.runFor(1000);
  expect(page.url()).toBe(originalUrl);
  expect(await events.allTextContents()).toEqual(originalEvents);
  expect(reads.filter((read) => read.includes('/history?'))).toHaveLength(count + 1);
  control.failHistory = false;
  await page.clock.fastForward(10_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await events.allTextContents()).toEqual(originalEvents);
});

test('out-of-range task pages differ from empty lists and empty filters @desktop', async ({ page }) => {
  const control = { totalTasks: 1000 };
  await mockApi(page, 'INITIATOR', 0, control);
  await page.goto('/tasks?page=9999&size=20&businessStatus=SUCCEEDED');
  await expect(page.getByRole('heading', { name: 'Страница не найдена', exact: true })).toBeVisible();
  await expect(page.getByText('Создайте первое задание.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'К первой странице', exact: true }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get('page')).toBe('0');
  expect(new URL(page.url()).searchParams.get('businessStatus')).toBe('SUCCEEDED');
  control.totalTasks = 0;
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Заданий пока нет', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'К первой странице', exact: true })).toHaveCount(0);
  control.totalTasks = 1000;
  await page.goto('/tasks?businessStatus=REJECTED');
  await expect(page.getByRole('heading', { name: 'Ничего не найдено', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сбросить фильтры', exact: true })).toBeVisible();
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: { userId, username: 'operator-fixture', role: 'OPERATOR' },
    }),
  );
  control.totalTasks = 0;
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await expect(page.getByText('Задания появятся после создания инициатором.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Создать задание', exact: true })).toHaveCount(0);
});

test('login header remains usable with production CSP at narrow and wide widths', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|violates.*directive/i.test(message.text())) violations.push(message.text());
  });
  await mockApi(page, 'INITIATOR', 0, { signedIn: false });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [1440, 1000],
    [900, 360],
  ]) {
    await page.setViewportSize({ width, height });
    const header = page.getByRole('banner');
    const theme = header.getByRole('combobox', { name: 'Цветовая тема', exact: true });
    await expect(header.getByRole('link', { name: 'Обмен с внешней системой', exact: true })).toBeVisible();
    await expect(header.locator('.ui-icon-mark')).toBeVisible();
    await expect(theme).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
    await selectChoice(page, 'Цветовая тема', 'Светлая');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await selectChoice(page, 'Цветовая тема', 'Тёмная');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const login = page.getByRole('textbox', { name: 'Логин', exact: true });
    await login.scrollIntoViewIfNeeded();
    await login.fill('production-fixture');
    await expect(login).toBeInViewport();
    await page.getByRole('button', { name: 'Войти', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeInViewport();
  }
  expect(violations).toEqual([]);
});

test('production CSP permits modal styles with a fresh document nonce', async ({ page, request }) => {
  await mockApi(page);
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|violates.*directive/i.test(message.text())) violations.push(message.text());
  });
  const response = await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  const nonce = await page.locator('meta[property="csp-nonce"]').evaluate((meta: HTMLMetaElement) => meta.nonce);
  expect(nonce).toMatch(/^[a-f0-9]{32}$/);
  expect(response!.headers()['content-security-policy']).toContain("'nonce-" + nonce + "'");
  const second = await request.get('/tasks');
  expect(second.headers()['content-security-policy']).not.toContain("'nonce-" + nonce + "'");
  expect(second.headers()['content-security-policy']).not.toContain('unsafe-inline');
  expect(second.headers()['cache-control']).toContain('no-store');
  const conditional = await request.get('/tasks', {
    headers: { 'If-Modified-Since': 'Wed, 01 Jan 2031 00:00:00 GMT', 'If-None-Match': '*' },
  });
  expect(conditional.status()).toBe(200);
  expect(conditional.headers()['etag']).toBeUndefined();
  expect(conditional.headers()['x-content-type-options']).toBe('nosniff');
  expect(conditional.headers()['content-security-policy']).toContain("script-src 'self'");
  const beforeWidth = await page.evaluate(() => document.documentElement.clientWidth);
  if (test.info().project.name === 'mobile') {
    await page.getByRole('button', { name: 'Фильтры заданий', exact: true }).click();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await selectChoice(page, 'Результат', 'Выполнено');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
  }
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Dirty production draft');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  expect(
    await page
      .locator('style')
      .evaluateAll((styles) =>
        styles.every(
          (style) => style.nonce === document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')!.nonce,
        ),
      ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(beforeWidth);
  expect(violations).toEqual([]);
});

test('exact filter bounds remain visible and unchanged until edited', async ({ page }) => {
  const reads = await mockApi(page);
  const from = '2026-11-16T07:30:45.000000001Z',
    to = '2026-11-16T07:30:45.000000002Z';
  await page.goto('/tasks?' + new URLSearchParams({ createdFrom: from, createdTo: to }));
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: 'Фильтры заданий', exact: true }).click();
  await expect(page.getByText('Точная граница: ' + from, { exact: false })).toBeVisible();
  await expect(page.getByText('Точная граница: ' + to, { exact: false })).toBeVisible();
  for (const read of reads.filter((read) => read.startsWith('/api/tasks?'))) {
    expect(new URL(read, 'http://localhost').searchParams.get('createdFrom')).toBe(from);
    expect(new URL(read, 'http://localhost').searchParams.get('createdTo')).toBe(to);
  }
  await page.getByLabel('Создано с (UTC, включительно)', { exact: true }).fill('2026-11-16T07:29');
  await expect(page).toHaveURL(/createdFrom=2026-11-16T07%3A29%3A00Z/);
  await expect(page.getByText('Точная граница: ' + from, { exact: false })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('createdTo')).toBe(to);
});

test('desktop navigation resets warm detail scroll and restores POP after query GC @desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.clock.install();
  await mockApi(page, 'OPERATOR', 50);
  await page.goto('/issues/' + taskId);
  const snapshotLink = page.getByRole('link', { name: 'Сверка, на которой основано решение', exact: true });
  await snapshotLink.scrollIntoViewIfNeeded();
  const oldTop = await page.locator('main').evaluate((main) => main.scrollTop);
  expect(oldTop).toBeGreaterThan(80);
  await snapshotLink.click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBe(0);
  await page.goBack();
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBeGreaterThan(80);
  await snapshotLink.click();
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBe(0);
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await page.clock.fastForward(5 * 60_000 + 1_000);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Расхождение при сверке', exact: true })).toHaveCount(1);
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBeGreaterThan(80);
  await page.goForward();
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 800, height: 480 });
  await page.getByRole('link', { name: 'К заданию', exact: true }).click();
  const next = page
    .getByRole('region', { name: 'История', exact: true })
    .getByRole('button', { name: 'Далее →', exact: true });
  await expect(next).toBeEnabled();
  const historyTop = await page.locator('main').evaluate((main) => main.scrollTop);
  expect(historyTop).toBe(0);
  await expect(next).toBeInViewport();
  await next.click();
  await expect(page).toHaveURL(/page=1/);
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBe(historyTop);
});
