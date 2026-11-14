import { test, expect } from '@playwright/test';
import type { Task } from '../../frontend/build/generated/openapi/client';
import { ApiSession } from '../support/http.mjs';
import { login } from './support';

for (const deliveryStatus of ['NEEDS_REVIEW', 'STOPPED'] as const) {
  test('UI-13: quiet polling for ' + deliveryStatus + ' refreshes card and history together', async ({ page }) => {
    await page.clock.install();
    await login(page);
    const user = await (await page.request.get('/api/session')).json();
    const id = crypto.randomUUID();
    const task = {
      taskId: id,
      operationId: crypto.randomUUID(),
      ownerId: user.userId,
      title: 'E2E интервал обновления',
      titleRevision: 1,
      request: { reference: 'REQ-850001', quantity: 25 },
      deliveryStatus,
      businessStatus: 'PENDING',
      createdAt: '2026-11-12T00:00:00Z',
    } satisfies Task;
    const reads = { card: 0, history: 0 };
    const aborted = { card: 0, history: 0 };
    page.on('requestfailed', (request) => {
      const path = new URL(request.url()).pathname;
      const resource =
        path === '/api/tasks/' + id ? 'card' : path === '/api/tasks/' + id + '/history' ? 'history' : undefined;
      if (resource) {
        expect(request.failure()?.errorText).toBe('net::ERR_ABORTED');
        aborted[resource]++;
      }
    });
    await page.route('**/api/tasks/' + id, (route) => {
      reads.card++;
      return route.fulfill({ json: task });
    });
    await page.route('**/api/tasks/' + id + '/history?*', (route) => {
      reads.history++;
      return route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
    });
    await page.goto('/tasks/' + id);
    await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
    // StrictMode cancels its first subscription; only one initial read completes.
    await expect.poll(() => reads.history - aborted.history).toBe(1);
    await expect(page.getByRole('status', { name: 'Загрузка…', exact: true })).toHaveCount(0);
    await expect(page.locator('.history-panel .paged-list')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('region', { name: 'История', exact: true }).getByRole('status')).toHaveText(
      'Нет записей',
    );
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    const before = { ...reads };
    expect(before.card - aborted.card).toBe(1);
    expect(before.history - aborted.history).toBe(1);
    await page.clock.runFor(8000);
    expect(reads).toEqual(before);
    await page.clock.runFor(3000);
    await expect.poll(() => reads.card).toBe(before.card + 1);
    await expect.poll(() => reads.history).toBe(before.history + 1);
  });
}

test('UI-14: a completed task receives another operator audit entry without reopening or changing business state', async ({
  page,
  baseURL,
}) => {
  await page.clock.install();
  await login(page);
  const csrf = await (await page.request.get('/api/csrf')).json();
  const created = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      title: 'E2E завершённая история ' + crypto.randomUUID(),
      request: { reference: 'REQ-850002', quantity: 25 },
    },
  });
  expect(created.status()).toBe(201);
  const { taskId } = await created.json();
  await page.goto('/tasks/' + taskId);
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
  const applied = page.locator('[data-event-id]').filter({ hasText: 'Принят внешний результат: SUCCEEDED' });
  await expect(applied.getByText('Получен результат исполнителя', { exact: true })).toBeVisible();
  await applied.getByText('Подробности обмена', { exact: true }).click();
  await expect(applied.getByText('Принят внешний результат: SUCCEEDED', { exact: true })).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  const operator = new ApiSession(baseURL);
  await operator.login('operator', process.env.SI_DEMO_PASSWORD);
  const saved = await operator.command('POST', '/api/tasks/' + taskId + '/reconciliations');
  expect(saved.outcome).toBe('MATCH');
  await expect(page.getByText('Сверка: MATCH', { exact: true })).toHaveCount(0);
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/tasks/' + taskId + '/history' && response.status() === 200;
  });
  await page.clock.runFor(11000);
  const history = await (await refreshed).json();
  expect(history.items.some((event: { summary: string }) => event.summary === 'Сверка: MATCH')).toBe(true);
  // Real HTTP can finish after runFor returns; let the paused browser flush query notifications.
  await page.clock.runFor(100);
  const reconciled = page.locator('[data-event-id]').filter({ hasText: 'Сверка: MATCH' });
  await expect(reconciled.getByText('Выполнена сверка с исполнителем', { exact: true })).toBeVisible();
  await reconciled.getByText('Подробности обмена', { exact: true }).click();
  await expect(reconciled.getByText('Сверка: MATCH', { exact: true })).toBeVisible();
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
});
