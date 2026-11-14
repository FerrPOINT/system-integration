import { expect, test } from '@playwright/test';
import { selectChoice } from '../e2e/support';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/choice-form.html');
});

test('R08: required, FormData and controlled/uncontrolled reset preserve one native owner', async ({ page }) => {
  await expect(page.locator('[data-base-choice-bridge]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Выберите значение');
  await expect(page.getByRole('combobox', { name: 'Controlled', exact: true })).toBeFocused();
  await selectChoice(page, 'Controlled', 'Beta');
  await selectChoice(page, 'Uncontrolled', 'Beta');
  await page.getByRole('button', { name: 'Inspect FormData' }).click();
  await expect(page.getByRole('status')).toHaveText('[["controlled","B"],["uncontrolled","B"]]');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Uncontrolled', exact: true })).toHaveAttribute('data-value', 'A');
  await expect(page.getByRole('combobox', { name: 'Controlled', exact: true })).toHaveAttribute('data-value', 'B');
  await page.getByRole('button', { name: 'Inspect FormData' }).click();
  await expect(page.getByRole('status')).toHaveText('[["controlled","B"],["uncontrolled","A"]]');
});

test('R08: disabled prop and native fieldset omit values without losing required validation', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle disabled' }).click();
  for (const name of ['Controlled', 'Uncontrolled'])
    await expect(page.getByRole('combobox', { name, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Inspect FormData' }).click();
  await expect(page.getByRole('status')).toHaveText('[]');
  await page.getByRole('button', { name: 'Toggle disabled' }).click();
  await expect(page.getByRole('combobox', { name: 'Controlled', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Выберите значение');
});

test('R08: keyboard skips disabled options, Tab leaves the popup, unavailable values remain explicit', async ({
  page,
}) => {
  const controlled = page.getByRole('combobox', { name: 'Controlled', exact: true });
  await controlled.click();
  await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Beta', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(controlled).toHaveAttribute('data-value', 'B');
  await controlled.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'Uncontrolled', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Use unavailable value' }).click();
  await expect(controlled).toContainText('RETIRED — недоступно');
  await page.getByRole('button', { name: 'Inspect FormData' }).click();
  await expect(page.getByRole('status')).toHaveText('[["controlled","RETIRED"],["uncontrolled","A"]]');
});
