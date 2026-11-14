import { test, expect } from '@playwright/test';
import { login, waitForRegistry } from './support';

test('UI-16: creation is modal, keeps filters, traps focus and restores its trigger', async ({ page }) => {
  await login(page);
  await page.goto('/tasks?businessStatus=SUCCEEDED');
  await waitForRegistry(page);
  const search = new URL(page.url()).search;
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое задание', exact: true });
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).search).toBe(search);
  await expect(page.locator('section.paged-list')).toHaveCount(1);
  await expect(dialog.getByLabel('Название *', { exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Название *', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Создать задание', exact: true })).toBeFocused();
  expect(new URL(page.url()).search).toBe(search);
});

test('UI-16: dirty form survives close, Escape and browser Back until discard is confirmed', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое задание', exact: true });
  await dialog.getByLabel('Название *', { exact: true }).fill('Несохранённое задание');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Закрыть форму?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Название *', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Название *', { exact: true })).toHaveValue('Несохранённое задание');
  await page.keyboard.press('Escape');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Название *', { exact: true })).toBeFocused();
  await page.mouse.click(4, 4);
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Название *', { exact: true })).toBeFocused();
  await page.evaluate(() => history.back());
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
});

test('UI-16: direct creation URL opens the same modal and short screens keep actions accessible', async ({ page }) => {
  await login(page);
  await page.goto('/tasks/new?businessStatus=SUCCEEDED');
  const dialog = page.getByRole('dialog', { name: 'Новое задание', exact: true });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 480 });
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const footer = el.querySelector('.base-dialog-footer')!.getBoundingClientRect();
        return {
          withinViewport: box.top >= 0 && box.bottom <= innerHeight,
          footerVisible: footer.bottom <= innerHeight,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      }),
    )
    .toEqual({ withinViewport: true, footerVisible: true, noOverflow: true });
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks\?businessStatus=SUCCEEDED/);
});

test('UI-16: pending creation locks fields and dismissal until the real command completes', async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let commands = 0;
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    commands++;
    await held;
    await route.continue();
  });
  try {
    await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Новое задание', exact: true });
    const title = 'E2E modal pending ' + crypto.randomUUID();
    await dialog.getByLabel('Название *', { exact: true }).fill(title);
    await dialog.getByLabel('Номер заявки').fill('REQ-870099');
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Название *', { exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => history.back());
    await expect(dialog).toBeVisible();
    release();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(commands).toBe(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
