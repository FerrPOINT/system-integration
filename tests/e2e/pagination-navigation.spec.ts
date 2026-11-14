import { expect, test } from '@playwright/test';

test('queued page measurement cannot undo an intentional route change', async ({ page }) => {
  await page.goto('/tests/pagination-navigation.html');
  await page.getByRole('button', { name: 'Measure initial layout' }).click();
  await expect(page).toHaveURL(/size=6/);
  await page.getByRole('button', { name: 'Navigate with queued measurement' }).click();
  await expect(page.getByRole('heading', { name: 'Destination', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/destination$/);
});

test('queued page measurement preserves a newer filter on the same route', async ({ page }) => {
  await page.goto('/tests/pagination-navigation.html');
  await page.getByRole('button', { name: 'Measure initial layout' }).click();
  await expect(page).toHaveURL(/size=6/);
  await page.getByRole('button', { name: 'Filter with queued measurement' }).click();
  await expect(page.getByRole('heading', { name: 'Source', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/filter=active&size=3/);
});
