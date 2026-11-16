import { expect, test } from '@playwright/test';

test('login enforces the generated HTML pattern and accepts a valid account', async ({ page }) => {
  const password = process.env.SI_DEMO_PASSWORD;
  if (!password) throw new Error('SI_DEMO_PASSWORD is required');
  let requests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/login') requests++;
  });
  await page.goto('/');
  const username = page.getByLabel('Логин *', { exact: true });
  const secret = page.getByLabel('Пароль *', { exact: true });
  await username.fill('invalid username');
  await secret.fill('test-only-invalid-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect(await username.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  expect(requests).toBe(0);

  await username.fill('initiator.one');
  expect(await username.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  await secret.fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  expect(requests).toBe(1);
  const sessionResponse = await page.request.get('/api/session');
  const csrfResponse = await page.request.get('/api/csrf');
  expect(sessionResponse.ok()).toBe(true);
  expect(csrfResponse.ok()).toBe(true);
  const session = await sessionResponse.json();
  const csrf = await csrfResponse.json();
  expect(csrf.userId).toBe(session.userId);
});
