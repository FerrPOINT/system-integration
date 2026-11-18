import { expect, test } from '@playwright/test';
import { login } from './support';

test('UI-09: task history fits the viewport and keeps page navigation below its records', async ({ page }, info) => {
  if (info.project.name === 'desktop') await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, 'operator');
  const tasks = await (await page.request.get('/api/tasks?businessStatus=SUCCEEDED&size=1')).json();
  expect(tasks.items.length).toBe(1);
  const task = tasks.items[0];
  await page.goto('/tasks/' + task.taskId);
  const history = page.getByRole('region', { name: 'История', exact: true });
  const state = page.getByRole('region', { name: 'Состояние задания', exact: true });
  await expect(history.locator('[data-event-id]').first()).toBeVisible();
  await expect(history.locator('details')).toHaveCount(0);
  if (info.project.name === 'mobile') {
    const summary = (await state.boundingBox())!,
      events = (await history.boundingBox())!;
    expect(events.y).toBeGreaterThanOrEqual(summary.y + summary.height);
    await expect(history.getByRole('navigation', { name: 'Страницы', exact: true })).toHaveCount(0);
    return;
  }
  async function fits() {
    await expect
      .poll(() =>
        history.evaluate((panel) => {
          const scrollArea = panel.querySelector('.paged-viewport')!;
          const viewport = scrollArea.getBoundingClientRect();
          const footer = panel.querySelector('.pagination-footer')!.getBoundingClientRect();
          const summary = document.querySelector('.task-summary')!.getBoundingClientRect();
          return {
            ready: panel.querySelector('[aria-busy]')!.getAttribute('aria-busy') === 'false',
            sideBySide: panel.getBoundingClientRect().right <= summary.left,
            footerVisible: footer.bottom <= innerHeight + 1,
            footerSeparated: viewport.bottom <= footer.top,
          };
        }),
      )
      .toEqual({ ready: true, sideBySide: true, footerVisible: true, footerSeparated: true });
    // Taller events may require scrolling within the page. Navigation stays visible.
    const search = new URL(page.url()).searchParams;
    const pageQuery = new URLSearchParams({ page: search.get('page') ?? '0', size: search.get('size')! });
    const response = await page.request.get('/api/tasks/' + task.taskId + '/history?' + pageQuery);
    expect(response.ok()).toBe(true);
    const { items } = await response.json();
    const last = history.locator('[data-event-id]').last();
    await expect(last).toHaveAttribute('data-event-id', items.at(-1).eventId);
    await history.getByRole('region', { name: 'События истории', exact: true }).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(last).toBeInViewport();
    await expect(history.locator('.pagination-footer')).toBeInViewport();
  }
  await expect(page).toHaveURL(/size=/);
  await fits();
  const short = Number(new URL(page.url()).searchParams.get('size'));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeGreaterThan(short);
  await fits();
  await page.setViewportSize({ width: 1280, height: 480 });
  await expect.poll(() => Number(new URL(page.url()).searchParams.get('size'))).toBeLessThan(short);
  await fits();
  const next = history.getByRole('button', { name: 'Далее →', exact: true });
  await expect(next).toBeInViewport();
  await next.click();
  await expect(page).toHaveURL(/page=1/);
  await fits();
});
