import { expect, type Page } from '@playwright/test';

export async function login(page: Page, username = 'initiator.one') {
  const password = process.env.SI_DEMO_PASSWORD;
  if (!password) throw new Error('SI_DEMO_PASSWORD is required for the isolated demo environment');
  await page.goto('/tasks');
  await page.getByLabel('Логин', { exact: true }).fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: username === 'operator' ? 'Все задания' : 'Мои задания', exact: true })).toBeVisible();
}

export async function selectChoice(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
