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
  const menu = page.getByRole('button', { name: 'Меню приложения', exact: true });
  if (name === 'Цветовая тема' && await menu.count() && !await page.getByRole('combobox', { name, exact: true }).count()) await menu.click();
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function waitForRegistry(page: Page) {
  // Wait for the first server window and its viewport-driven size before the next action.
  const registry=page.locator('section.paged-list');
  await expect.poll(async () => {
    if (await registry.getAttribute('aria-busy') !== 'false') return false;
    return page.viewportSize()!.width <= 760 || await registry.locator('[data-page-item]').count() === 0 || new URL(page.url()).searchParams.has('size');
  }).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(registry).toHaveAttribute('aria-busy','false');
}

export async function openAccountMenu(page: Page) {
  if (page.viewportSize()!.width > 760) return;
  const menu = page.getByRole('button', { name: 'Меню приложения', exact: true });
  await expect(menu).toBeVisible();
  if (await menu.getAttribute('aria-expanded') === 'false') await menu.click();
}

export async function collectFeed(page: Page, region: import('@playwright/test').Locator) {
  const footer = region.locator('[data-feed-end]');
  for (let attempt = 0; attempt < 100; attempt++) {
    await expect(region).toHaveAttribute('aria-busy', 'false');
    const count = await region.locator('[data-page-item]').count();
    const summary = await footer.innerText();
    const total = Number(summary.match(/из (\d+)/)![1]);
    if (count === total) return;
    await footer.scrollIntoViewIfNeeded();
    await expect.poll(() => region.locator('[data-page-item]').count()).toBeGreaterThan(count);
  }
  throw new Error('Mobile feed did not terminate');
}
