import { test, expect } from '@playwright/test';
import { login, selectChoice } from './support';

const themeLabels: Record<string, string> = { dark: 'Тёмная', light: 'Светлая', gray: 'Серая' };
const key = 'system-integration.theme';

test('UI-01: dark default, all palettes and readable controls', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const picker = page.getByRole('combobox', { name: 'Цветовая тема', exact: true });
  for (const theme of ['light', 'gray', 'dark']) {
    await selectChoice(page, 'Цветовая тема', themeLabels[theme]);
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
      return ['.login-panel .base-page-title', '.login-panel .base-page-context', '.login-panel .base-button[data-variant="default"]', '.theme-control .base-choice-trigger', '.login-panel input'].map(selector => {
        const el = document.querySelector(selector)!;
        const colors = [luminance(rgb(getComputedStyle(el).color)), luminance(rgb(background(el)))].sort((a, b) => a - b);
        return { selector, ratio: (colors[1] + .05) / (colors[0] + .05) };
      });
    });
    for (const contrast of contrasts) expect(contrast.ratio, `${theme}: ${contrast.selector}`).toBeGreaterThanOrEqual(4.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.reload();
  await expect(picker).toHaveAttribute('data-value', 'dark');
});

test('UI-02: theme survives navigation and logout, synchronizes tabs and preserves the form', async ({ page, context }, info) => {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Цветовая тема', exact: true });
  await selectChoice(page, 'Цветовая тема', themeLabels['gray']);
  await login(page);
  await expect(picker).toHaveAttribute('data-value', 'gray');
  if (info.project.name === 'mobile') {
    const brand = await page.locator('.app-header > .brand-link').boundingBox();
    expect(brand!.width).toBeGreaterThan(150);
    expect(brand!.height).toBeLessThan(80);
  }
  const filters = page.locator('.filter-panel');
  await expect(filters).toHaveJSProperty('open', info.project.name !== 'mobile');
  if (info.project.name === 'mobile') await filters.locator('summary').click();
  await selectChoice(page, 'Результат', 'Выполнено');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page).toHaveURL(/businessStatus=SUCCEEDED/);
  await selectChoice(page, 'Результат', 'Все результаты');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page).not.toHaveURL(/businessStatus=/);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByLabel('Название *', { exact: true }).fill('Черновик сохраняется при смене темы');
  await selectChoice(page, 'Цветовая тема', themeLabels['light']);
  await expect(page.getByLabel('Название *', { exact: true })).toHaveValue('Черновик сохраняется при смене темы');
  const other = await context.newPage();
  try {
    await other.goto('/tasks');
    await expect(other.getByRole('combobox', { name: 'Цветовая тема', exact: true })).toHaveAttribute('data-value', 'light');
    await selectChoice(other, 'Цветовая тема', 'Тёмная');
    await expect(picker).toHaveAttribute('data-value', 'dark');
    await expect(page.getByLabel('Название *', { exact: true })).toHaveValue('Черновик сохраняется при смене темы');
  } finally { await other.close(); }
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await expect(picker).toHaveAttribute('data-value', 'dark');
});

test('UI-03: invalid saved preference is explained and can be corrected', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'unsupported'), key);
  await page.goto('/');
  await expect(page.getByText('Сохранённая тема не распознана. Выберите тему заново.')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await selectChoice(page, 'Цветовая тема', themeLabels['gray']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'gray');
  await expect(page.getByText('Сохранённая тема не распознана. Выберите тему заново.')).toHaveCount(0);
});

test('UI-04: blocked storage keeps the chosen theme usable and explains persistence', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage is blocked', 'SecurityError'); } }));
  await page.goto('/');
  await expect(page.getByText('Браузер не сохраняет тему. Выбор действует в этой вкладке.')).toBeVisible();
  await selectChoice(page, 'Цветовая тема', themeLabels['light']);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
});

test('UI-05: Base popup uses the selected palette, safe arrow spacing and keyboard focus', async ({ page }) => {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Цветовая тема', exact: true });
  for (const theme of ['dark', 'light', 'gray']) {
    await selectChoice(page, 'Цветовая тема', themeLabels[theme]);
    const gap = await picker.evaluate(el => {
      const button = el.getBoundingClientRect();
      const icon = el.querySelector('svg')!.getBoundingClientRect();
      return button.right - icon.right;
    });
    expect(gap).toBeGreaterThanOrEqual(16);
    await picker.press('Enter');
    const popup = page.getByRole('listbox');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('option', { selected: true })).toHaveText(themeLabels[theme]);
    const palette = await popup.evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      right: el.getBoundingClientRect().right,
    }));
    const surface = await page.locator('.login-panel').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(palette.background).toBe(surface);
    expect(palette.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    await popup.press('Escape');
    await expect(picker).toBeFocused();
  }
  await picker.press('Enter');
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: 'Тёмная', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('data-value', 'dark');
  await expect(picker).toBeFocused();
  await picker.press('Enter');
  await expect(page.getByRole('option', { selected: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByLabel('Логин *', { exact: true })).toBeFocused();
});

test('UI-06: shared brand, surfaces and form fields across the application', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  await expect(page.locator('.app-brand .base-icon-mark svg')).toHaveCount(1);
  const logo = await page.locator('.app-brand').innerHTML();
  const surface = await page.locator('.login-panel').evaluate(el => ({
    radius: getComputedStyle(el).borderRadius,
    padding: getComputedStyle(el.querySelector('.base-card-content')!).padding,
  }));
  await expect(page.getByLabel('Логин *', { exact: true })).toHaveAttribute('required', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await login(page);
  expect(await page.locator('.app-brand').innerHTML()).toBe(logo);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Новое задание', exact: true })).toHaveClass('base-page-title');
  const editor = page.locator('main .base-card');
  expect(await editor.evaluate(el => ({
    radius: getComputedStyle(el).borderRadius,
    padding: getComputedStyle(el.querySelector('.base-card-content')!).padding,
  }))).toEqual(surface);
  const reference = page.getByLabel('Номер заявки');
  await expect(reference).toHaveAttribute('aria-describedby', 'field-reference-hint');
  await expect(page.locator('#field-reference-hint')).toHaveText('REQ- и шесть цифр. После создания изменить нельзя.');
  await expect(reference).toHaveAttribute('required', '');
  expect(await page.evaluate(() => document.querySelectorAll('button:not(.base-control), input:not(.base-control), textarea:not(.base-control)').length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
