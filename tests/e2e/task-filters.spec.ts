import { test, expect } from '@playwright/test';
import { login, selectChoice, waitForRegistry } from './support';
import { loadUiEnvironment } from '../load/environment.mjs';

test('UI-17: filters keep the header unscrolled and remain reachable on short screens', async ({ page }, info) => {
  loadUiEnvironment();
  await login(page, 'operator');
  const tools = page.locator('.list-tools');
  const trigger = page.getByLabel('Фильтры заданий', { exact: true });
  const viewports =
    info.project.name === 'mobile'
      ? [
          { width: 497, height: 1244 },
          { width: 390, height: 844 },
          { width: 390, height: 480 },
        ]
      : [
          { width: 1440, height: 1000 },
          { width: 761, height: 844 },
        ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await waitForRegistry(page);
    expect(await tools.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    const size = Number(new URL(page.url()).searchParams.get('size'));
    await trigger.click();
    if (info.project.name === 'mobile') {
      const dialog = page.getByRole('dialog', { name: 'Фильтры заданий', exact: true });
      await expect(dialog).toBeVisible();
      const done = dialog.getByRole('button', { name: 'Готово', exact: true });
      await expect(done).toBeVisible();
      const doneBox = (await done.boundingBox())!;
      expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(viewport.height);
      expect(Number(new URL(page.url()).searchParams.get('size'))).toBe(size);
      await selectChoice(page, 'Результат', 'Выполнено');
      await expect(page).toHaveURL(/businessStatus=SUCCEEDED/);
      await done.click();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('data-active', 'true');
      await trigger.click();
      await expect(dialog.getByRole('combobox', { name: 'Результат', exact: true })).toHaveAttribute(
        'data-value',
        'SUCCEEDED',
      );
      const until = dialog.getByLabel('Создано до (UTC, не включая)', { exact: true });
      await until.scrollIntoViewIfNeeded();
      await expect(until).toBeVisible();
      await expect(done).toBeVisible();
      await page.screenshot({ path: info.outputPath('filters-' + viewport.height + '.png') });
      await dialog.getByRole('button', { name: 'Сбросить', exact: true }).click();
      await expect(page).not.toHaveURL(/businessStatus=/);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } else {
      await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(size);
      await trigger.click();
      await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBe(size);
    }
    await waitForRegistry(page);
    expect(await tools.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (info.project.name === 'desktop')
      expect(
        await page
          .locator('.pagination-footer')
          .evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight + 1),
      ).toBe(true);
    else await expect(page.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
  }
});

test('UTC URL filters validate calendars and normalize the actual API request', async ({ page }) => {
  loadUiEnvironment();
  await login(page, 'operator');
  const reads: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/tasks' && request.method() === 'GET') reads.push(url);
  });
  for (const value of ['2026-02-30T00:00:00Z', '+010000-01-01T00:00:00Z', '2026-11-14T00:00:00-00:00']) {
    reads.length = 0;
    await page.goto('/tasks?' + new URLSearchParams({ createdFrom: value }));
    await expect(page.getByRole('alert')).toContainText('Некорректные параметры');
    await expect(page.locator('section.paged-list')).toHaveAttribute('aria-busy', 'false');
    expect(reads).toHaveLength(0);
  }
  for (const [createdFrom, createdTo, normalizedFrom] of [
    ['2026-11-14T07:30:00+07:00', '2026-11-15T00:00:00Z', '2026-11-14T00:30:00Z'],
    ['2026-11-14T00:00:00.000000001Z', '2026-11-14T00:00:00.000000002Z', '2026-11-14T00:00:00.000000001Z'],
  ]) {
    const response = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/tasks' && url.searchParams.get('createdFrom') === normalizedFrom;
    });
    await page.goto('/tasks?' + new URLSearchParams({ createdFrom, createdTo }));
    expect((await response).status()).toBe(200);
    await waitForRegistry(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(reads.at(-1)?.searchParams.get('createdFrom')).toBe(normalizedFrom);
    expect(reads.at(-1)?.searchParams.get('createdTo')).toBe(createdTo);
  }
});
