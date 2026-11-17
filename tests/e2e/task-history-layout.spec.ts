import { expect, test } from '@playwright/test';
import { login } from './support';

test('UI-15: task history stays in the left pane or follows the summary on mobile', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, 'operator');
  const tasks = await (await page.request.get('/api/tasks?businessStatus=SUCCEEDED&size=1')).json();
  expect(tasks.items.length).toBe(1);
  await page.goto('/tasks/' + tasks.items[0].taskId);
  const history = page.getByRole('region', { name: 'История', exact: true });
  const viewport = history.getByRole('region', { name: 'События истории', exact: true });
  const state = page.getByRole('region', { name: 'Состояние задания', exact: true });
  await expect(history.locator('[data-event-id]').first()).toBeVisible();
  await expect(history.locator('[data-feed-end]')).toBeAttached();
  await expect(history.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/size=|page=/);
  if (info.project.name === 'mobile') {
    const summary = (await state.boundingBox())!,
      events = (await history.boundingBox())!;
    expect(events.y).toBeGreaterThanOrEqual(summary.y + summary.height);
    expect(await viewport.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    return;
  }
  for (const height of [720, 1000, 480]) {
    await page.setViewportSize({ width: 1280, height });
    const summary = (await state.boundingBox())!,
      events = (await history.boundingBox())!;
    expect(events.x + events.width).toBeLessThanOrEqual(summary.x);
    expect(events.y + events.height).toBeLessThanOrEqual(height + 1);
    await viewport.focus();
    await expect(viewport).toBeFocused();
  }
});
