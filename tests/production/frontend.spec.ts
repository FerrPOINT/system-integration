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
async function mockApi(page: Page, role = 'INITIATOR', historyCount = 0) {
  const reads: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      reads.push(url.pathname + url.search);
      if (url.pathname === '/api/session')
        return route.fulfill({ json: { userId, username: 'production-fixture', role } });
      if (url.pathname === '/api/tasks') {
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
            : 1000;
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
              type: 'CREATED',
              summary: 'History event ' + (pageNumber * size + n),
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
  await next.scrollIntoViewIfNeeded();
  const historyTop = await page.locator('main').evaluate((main) => main.scrollTop);
  expect(historyTop).toBeGreaterThan(80);
  await next.click();
  await expect(page).toHaveURL(/page=1/);
  await expect.poll(() => page.locator('main').evaluate((main) => main.scrollTop)).toBe(historyTop);
});
