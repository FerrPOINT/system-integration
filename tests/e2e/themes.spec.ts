import { test, expect } from '@playwright/test';
import { login } from './support';

const key = 'system-integration.theme';

test('UI-01: dark default, all palettes and readable controls', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const picker = page.getByRole('combobox', { name: 'Цветовая тема', exact: true });
  for (const theme of ['dark', 'light', 'gray']) {
    await picker.selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(theme);
    const contrasts = await page.evaluate(() => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (color: number[]) => color.map(c => { const n = c / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; })
        .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const background = (el: Element): string => {
        const color = getComputedStyle(el).backgroundColor;
        return color !== 'transparent' && !color.endsWith(', 0)') ? color : background(el.parentElement!);
      };
      return ['.login-panel h2', '.login-panel > .muted', '.login-panel .primary', '.theme-control select', '.login-panel input'].map(selector => {
        const el = document.querySelector(selector)!;
        const colors = [luminance(rgb(getComputedStyle(el).color)), luminance(rgb(background(el)))].sort((a, b) => a - b);
        return { selector, ratio: (colors[1] + .05) / (colors[0] + .05) };
      });
    });
    for (const contrast of contrasts) expect(contrast.ratio, `${theme}: ${contrast.selector}`).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.reload();
  await expect(picker).toHaveValue('gray');
});

test('UI-02: theme survives navigation and logout, synchronizes tabs and preserves the form', async ({ page, context }, info) => {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Цветовая тема', exact: true });
  await picker.selectOption('gray');
  await login(page);
  await expect(picker).toHaveValue('gray');
  if (info.project.name === 'mobile') {
    const brand = await page.locator('.app-header > .brand').boundingBox();
    expect(brand!.width).toBeGreaterThan(150);
    expect(brand!.height).toBeLessThan(80);
  }
  const filters = page.locator('.filter-panel');
  await expect(filters).toHaveJSProperty('open', info.project.name !== 'mobile');
  if (info.project.name === 'mobile') await filters.locator('summary').click();
  await page.getByRole('combobox', { name: 'Результат', exact: true }).selectOption('SUCCEEDED');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page).toHaveURL(/businessStatus=SUCCEEDED/);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Черновик сохраняется при смене темы');
  await picker.selectOption('light');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Черновик сохраняется при смене темы');
  const other = await context.newPage();
  try {
    await other.goto('/tasks');
    await expect(other.getByRole('combobox', { name: 'Цветовая тема', exact: true })).toHaveValue('light');
    await other.getByRole('combobox', { name: 'Цветовая тема', exact: true }).selectOption('dark');
    await expect(picker).toHaveValue('dark');
    await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Черновик сохраняется при смене темы');
  } finally { await other.close(); }
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(picker).toHaveValue('dark');
});

test('UI-03: invalid saved preference is explained and can be corrected', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'unsupported'), key);
  await page.goto('/');
  await expect(page.getByText('Сохранённая тема не распознана. Выберите тему заново.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: 'Цветовая тема', exact: true }).selectOption('gray');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gray');
  await expect(page.getByText('Сохранённая тема не распознана. Выберите тему заново.')).toHaveCount(0);
});

test('UI-04: blocked storage keeps the chosen theme usable and explains persistence', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage is blocked', 'SecurityError'); } }));
  await page.goto('/');
  await expect(page.getByText('Браузер не сохраняет тему. Выбор действует в этой вкладке.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Цветовая тема', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});
