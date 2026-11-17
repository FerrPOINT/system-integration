import { expect, type Page, type Locator } from '@playwright/test';

export async function login(page: Page, username = 'initiator.one') {
  const password = process.env.SI_DEMO_PASSWORD;
  if (!password) throw new Error('SI_DEMO_PASSWORD is required for the isolated demo environment');
  await page.goto('/tasks');
  await page.getByLabel('Логин *', { exact: true }).fill(username);
  await page.getByLabel('Пароль *', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: username === 'operator' ? 'Все задания' : 'Мои задания', exact: true }),
  ).toBeVisible();
}

export async function selectChoice(page: Page, name: string, option: string) {
  const menu = page.getByRole('button', { name: 'Меню приложения', exact: true });
  if (
    name === 'Цветовая тема' &&
    (await menu.count()) &&
    !(await page.getByRole('combobox', { name, exact: true }).count())
  )
    await menu.click();
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

export async function waitForRegistry(page: Page) {
  // Wait for the first server window and its viewport-driven size before the next action.
  const registry = page.locator('section.paged-list');
  await expect
    .poll(async () => {
      if ((await registry.getAttribute('aria-busy')) !== 'false') return false;
      return (
        page.viewportSize()!.width <= 760 ||
        (await registry.locator('[data-page-item]').count()) === 0 ||
        new URL(page.url()).searchParams.has('size')
      );
    })
    .toBe(true);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(registry).toHaveAttribute('aria-busy', 'false');
}

export async function openAccountMenu(page: Page) {
  if (page.viewportSize()!.width > 760) return;
  const menu = page.getByRole('button', { name: 'Меню приложения', exact: true });
  await expect(menu).toBeVisible();
  if ((await menu.getAttribute('aria-expanded')) === 'false') await menu.click();
}

export async function collectFeed(region: Locator, selector: string, attribute: string) {
  const footer = region.locator('[data-feed-end]');
  const range = footer.locator('small[aria-live=polite]');
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 100; attempt++) {
    await expect(region).toHaveAttribute('aria-busy', 'false');
    const match = /^(\d+)–(\d+) из (\d+)$/.exec(await range.innerText());
    expect(match, 'Mobile feed must show its loaded range').not.toBeNull();
    const [, start, end, total] = match!.map(Number);
    const ids = await region
      .locator(selector)
      .evaluateAll((elements, name) => elements.map((element) => element.getAttribute(name) ?? ''), attribute);
    expect(ids).toHaveLength(end - start + 1);
    expect(ids.length).toBeLessThanOrEqual(100);
    expect(ids).not.toContain('');
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) seen.add(id);
    if (end === total) {
      expect(seen.size).toBe(total);
      return seen;
    }
    await footer.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const position = /^(\d+)–(\d+) из (\d+)$/.exec(await range.innerText());
        return Number(position?.[2] ?? 0);
      })
      .toBeGreaterThan(end);
  }
  throw new Error('Mobile feed did not reach the last record');
}
