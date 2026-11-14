import { expect, test } from '@playwright/test';

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
