import { expect, test } from '@playwright/test';

test('a missing required browser API fails explicitly instead of selecting desktop defaults', async ({ page }) => {
  await page.goto('/tests/error-boundary.html?media');
  await expect(page.getByRole('heading', { name: 'Working page' })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true });
  });
  await page.getByRole('link', { name: 'Break page' }).click();
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить страницу', exact: true })).toBeVisible();
  await expect(page.getByText('Desktop', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Mobile', { exact: true })).toHaveCount(0);
});

for (const query of ['', '?value', '?nested', '?nested&value']) {
  test('render failure has a safe recovery path ' + (query || 'root'), async ({ page }) => {
    await page.goto('/tests/error-boundary.html' + query);
    await page.getByRole('link', { name: 'Break page' }).click();
    await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('PRIVATE_DIAGNOSTIC');
    await expect(page.locator('body')).not.toContainText('Unexpected Application Error');
    await expect(page.getByRole('navigation', { name: 'Fixture shell' })).toHaveCount(query.includes('nested') ? 1 : 0);
    await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Working page' })).toBeVisible();
  });
}

test('lazy chunk failure preserves the shell and offers recovery', async ({ page }) => {
  await page.goto('/tests/error-boundary.html?nested');
  await page.getByRole('link', { name: 'Break chunk' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Fixture shell' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_DIAGNOSTIC');
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Working page' })).toBeVisible();
});
