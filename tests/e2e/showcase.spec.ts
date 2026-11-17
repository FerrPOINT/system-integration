import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectFeed, login, selectChoice } from './support';
import { loadUiEnvironment } from '../load/environment.mjs';
import { showcaseDirectory } from '../../seed/report.mjs';

type Example = { scenario: string; taskId: string; issueId: string | null; title: string; owner: string };
type Showcase = { target: 'load'; examples: Example[]; generalIssues: { issueId: string; status: string }[] };

function showcase(): Showcase {
  loadUiEnvironment();
  const report: Showcase = JSON.parse(readFileSync(new URL('showcase.json', showcaseDirectory('load')), 'utf8'));
  if (report.target !== 'load') throw new Error('The UI tests require a showcase report from the load installation');
  return report;
}

test('showcase: both initiators can browse realistic tasks and their own long history', async ({ page }, info) => {
  const data = showcase();
  const owner = info.project.name === 'mobile' ? 'initiator.two' : 'initiator.one';
  const task = data.examples.find((item) => item.scenario === 'long' && item.owner === owner)!;
  await login(page, owner);
  await page.goto('/tasks/' + task.taskId);
  await expect(page.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Состояние задания', exact: true })).toContainText('Выполнено');
  const history = page.getByRole('region', { name: 'История', exact: true });
  await expect(history.locator('[data-event-id]').first()).toBeVisible();
  await expect(history.getByRole('navigation', { name: 'Страницы' })).toHaveCount(0);
  const seen = await collectFeed(history.locator('.paged-list'), '[data-event-id]', 'data-event-id');
  expect(seen.size).toBeGreaterThan(120);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test('showcase: every curated task state renders through the real API', async ({ page }) => {
  test.setTimeout(90_000);
  const data = showcase();
  await login(page, 'operator');
  const seen = new Set<string>();
  for (const item of data.examples) {
    if (seen.has(item.scenario)) continue;
    seen.add(item.scenario);
    await page.goto('/tasks/' + item.taskId);
    await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'История', exact: true }).locator('[data-event-id]').first(),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Состояние задания', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  }
  expect(seen.size).toBe(20);
});

test('showcase: operator sees assigned issues, saved decisions and general feed problems', async ({ page }) => {
  const data = showcase();
  await login(page, 'operator');
  for (const scenario of ['unavailable', 'retry', 'protocol', 'difference', 'conflict', 'stale', 'assigned']) {
    const item = data.examples.find((item) => item.scenario === scenario)!;
    await page.goto('/issues/' + item.issueId);
    await expect(page.getByRole('heading', { name: 'Открытый разбор', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Действия оператора', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Открыть последнюю сверку', exact: true })).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  for (const scenario of ['applied', 'stopped']) {
    const item = data.examples.find((item) => item.scenario === scenario)!;
    await page.goto('/issues/' + item.issueId);
    await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Решение', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Действия оператора', exact: true })).toHaveCount(0);
  }
  await page.goto('/issues/' + data.generalIssues.find((item) => item.status === 'OPEN')!.issueId);
  await expect(page.getByText('Общая проблема ленты', { exact: true })).toBeVisible();
  await selectChoice(page, 'Действие', 'Закрыть общую проблему');
  await expect(page.getByRole('button', { name: 'Закрыть общую проблему', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
