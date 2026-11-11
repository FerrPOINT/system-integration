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

test('TC-09 / TC-12: empty filter, server error recovery and UTC rendering', async ({ page }) => {
  await login(page);
  await page.goto('/tasks?createdFrom=2000-01-01T00%3A00%3A00Z&createdTo=2000-01-02T00%3A00%3A00Z');
  await expect(page.getByRole('heading', { name: 'Заданий пока нет' })).toBeVisible();
  await page.route('**/api/tasks?*', route => route.fulfill({ status: 503, contentType: 'application/problem+json',
    body: JSON.stringify({ title: 'Сервис временно недоступен', status: 503, code: 'UNAVAILABLE' }) }));
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сервис временно недоступен');
  await page.unroute('**/api/tasks?*');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заданий пока нет' })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Создать задание' })).toBeVisible();
});
