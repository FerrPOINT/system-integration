import { test, expect, type Locator } from '@playwright/test';
import { login, waitForRegistry } from './support';
import { loadUiEnvironment } from '../load/environment.mjs';

async function clickCellEdge(cell: Locator, options: { modifiers?: ['Control']; button?: 'middle' } = {}) {
  const box = (await cell.boundingBox())!;
  const link = cell.locator('..').getByRole('link');
  const origin = (await link.boundingBox())!;
  // Address the native link's extended hit area, outside its title box.
  await link.click({ position: { x: box.x + box.width - 5 - origin.x, y: box.y + box.height / 2 - origin.y }, ...options });
}

test('UI-18: whole table rows preserve native navigation, new tabs and keyboard access', async ({ page, context }) => {
  loadUiEnvironment();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page, 'operator');
  for (const [route, caption] of [['/tasks', 'Реестр заданий'], ['/issues', 'Реестр разборов обмена']]) {
    await page.goto(route);
    const table = page.getByRole('table', { name: caption, exact: true });
    await expect(table).toBeVisible();
    for (const [index, width] of [[0, 900], [1, 1280]]) {
      await page.setViewportSize({ width, height: 1000 });
      await waitForRegistry(page);
      const row = table.locator('tbody tr').nth(index);
      const link = row.getByRole('link');
      await expect(link).toHaveCount(1);
      const href = (await link.getAttribute('href'))!;
      // Neither the title nor its text is the click target.
      await clickCellEdge(index === 0 ? row.getByRole('cell').nth(1) : row.getByRole('cell').last());
      await expect.poll(() => new URL(page.url()).pathname).toBe(href);
      await expect(page.locator('main h1')).toBeVisible();
      await page.goBack();
      await expect(table).toBeVisible();
    }
    await waitForRegistry(page);
    const row = table.locator('tbody tr').first();
    const link = row.getByRole('link');
    const href = (await link.getAttribute('href'))!;
    const listUrl = page.url();
    await table.getByRole('columnheader').last().click();
    await expect(page).toHaveURL(listUrl);
    for (const action of [{ modifiers: ['Control'] as ['Control'] }, { button: 'middle' as const }]) {
      const opened = context.waitForEvent('page');
      await clickCellEdge(row.getByRole('cell').last(), action);
      const popup = await opened;
      try {
        await expect.poll(() => new URL(popup.url()).pathname).toBe(href);
        await expect(popup.locator('main h1')).toBeVisible();
        await expect(page).toHaveURL(listUrl);
      } finally { await popup.close(); }
    }
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname).toBe(href);
    await expect(page.locator('main h1')).toBeVisible();
  }
});
