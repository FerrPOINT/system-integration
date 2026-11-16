import { expect, test } from '@playwright/test';

const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
test.beforeEach(async ({ page }) => {
  // Every API request is intercepted: this component suite never uses backend data.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/history'))
        return route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
      if (url.pathname === '/api/csrf') return route.fulfill({ json: { token: 'fixture' } });
      const index = ids.findIndex((id) => url.pathname === '/api/tasks/' + id);
      if (index < 0) throw new Error('Unexpected fixture request: ' + url.pathname);
      if (route.request().method() === 'PATCH') return route.fulfill({ json: { taskId: ids[index] } });
      return route.fulfill({
        json: {
          taskId: ids[index],
          operationId: ids[index],
          ownerId: '00000000-0000-4000-8000-000000000003',
          title: 'Task ' + (index ? 'B' : 'A'),
          titleRevision: index && !new URL(page.url()).searchParams.has('equal') ? 7 : 1,
          request: { reference: 'REQ-00000' + (index + 1), quantity: 25 },
          createdAt: '2026-11-14T00:00:00Z',
          deliveryStatus: 'ACKNOWLEDGED',
          businessStatus: 'SUCCEEDED',
        },
      });
    },
  );
});

for (const query of ['', '?equal', '?cold']) {
  test('task identity resets edit state on navigation and history ' + (query || 'warm'), async ({ page }) => {
    await page.goto('/tests/task-identity.html' + query);
    await page.getByRole('button', { name: 'Изменить название' }).click();
    await page.getByRole('textbox', { name: 'Новое название' }).fill('Draft A');
    await page.getByRole('button', { name: 'Open B', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Task B', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Изменить название' }).click();
    await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Task B');
    const request = page.waitForRequest((request) => request.method() === 'PATCH');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    expect((await request).url()).toContain('/api/tasks/' + ids[1]);
    expect((await request).postDataJSON()).toEqual({
      title: 'Task B',
      expectedTitleRevision: query === '?equal' ? 1 : 7,
    });
    await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
    await page.getByRole('button', { name: 'History back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Task A', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Изменить название' }).click();
    await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Task A');
  });
}

test('same-task refetch preserves the draft and the revision at edit start', async ({ page }) => {
  await page.goto('/tests/task-identity.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Draft A');
  await page.getByRole('button', { name: 'Refresh A', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Server A', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Draft A');
  const request = page.waitForRequest((request) => request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ title: 'Draft A', expectedTitleRevision: 1 });
});

test('local cancel and route departure require discard and restore focus on cancel', async ({ page }) => {
  await page.goto('/tests/task-identity.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  const title = page.getByRole('textbox', { name: 'Новое название' });
  await title.fill('Keep this draft');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task A', exact: true })).toBeVisible();
  await expect(title).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(title).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Изменить название', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await expect(title).toHaveValue('Task A');
});

test('same-record history parameters do not discard or block the draft', async ({ page }) => {
  await page.goto('/tests/task-identity.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('History draft');
  await page.getByRole('button', { name: 'Change history page' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('History draft');
});

test('pending rename blocks editing, cancel and route departure until acknowledgement', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/tasks/' + ids[0],
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await gate;
      await route.fulfill({ json: { taskId: ids[0] } });
    },
  );
  await page.goto('/tests/task-identity.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Pending draft');
  const sent = page.waitForRequest((request) => request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await sent;
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task A', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  release();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open B', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Task B', exact: true })).toBeVisible();
});

test('native reload warns before discarding a draft', async ({ page }) => {
  await page.goto('/tests/task-identity.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Reload draft');
  const shown = page.waitForEvent('dialog');
  // A dismissed reload intentionally never reaches a new load event.
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  const dialog = await shown;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Reload draft');
});

test('clean cancellation and accepted rename return focus to their trigger', async ({ page }) => {
  await page.goto('/tests/task-identity.html');
  const trigger = page.getByRole('button', { name: 'Изменить название', exact: true });
  await trigger.click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await trigger.click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
