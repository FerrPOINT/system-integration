import { expect, type Page } from '@playwright/test';

export async function login(page: Page, username = 'initiator.one') {
  const password = process.env.SI_DEMO_PASSWORD;
  if (!password) throw new Error('SI_DEMO_PASSWORD is required for the isolated demo environment');
  await page.goto('/tasks');
  await page.getByLabel('Логин *', { exact: true }).fill(username);
  await page.getByLabel('Пароль *', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: username === 'operator' ? 'Все задания' : 'Мои задания', exact: true })).toBeVisible();

}

export async function selectChoice(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function waitForRegistry(page: Page) {
  // Wait for the first server window and its viewport-driven size before the next action.
  const registry=page.locator('section.paged-list');
  await expect.poll(async () => {
    if (await registry.getAttribute('aria-busy') !== 'false') return false;
    return await registry.locator('[data-page-item]').count() === 0 || new URL(page.url()).searchParams.has('size');
  }).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(registry).toHaveAttribute('aria-busy','false');
}
