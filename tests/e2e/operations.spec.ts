import { test, expect } from '@playwright/test';
import { login, openAccountMenu, selectChoice } from './support';
import { execFileSync } from 'node:child_process';
import { loadUiEnvironment } from '../load/environment.mjs';

const external = process.env.SI_EMULATOR_URL || 'http://127.0.0.1:19681';

test.afterEach(async ({ request }) => {
  for (const reference of ['REQ-810001', 'REQ-810002', 'REQ-820001', 'REQ-820002', 'REQ-850001', 'REQ-850002'])
    expect((await request.delete(`${external}/test/faults/${reference}`)).status()).toBe(204);
});

test('TC-03 / TC-07: lost reply, independent execution, reconciliation and operator decision', async ({
  page,
  request,
}, info) => {
  const reference = info.project.name === 'mobile' ? 'REQ-810002' : 'REQ-810001';
  expect((await request.delete(`${external}/test/faults/${reference}`)).status()).toBe(204);
  expect(
    (
      await request.put(`${external}/test/faults/${reference}`, { data: { mode: 'DROP_RESPONSE_AFTER_EXECUTION' } })
    ).status(),
  ).toBe(204);
  await login(page);
  await page.getByRole('link', { name: 'Создать задание' }).click();
  const title = 'E2E разбор ' + crypto.randomUUID();
  await page.getByLabel('Название *', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки *', { exact: true }).fill(reference);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Получено исполнителем', { exact: true })).toBeVisible();
  await expect(page.getByText('Ожидает исполнения', { exact: true })).toBeVisible();
  const taskPath = new URL(page.url()).pathname;
  const taskId = taskPath.split('/').at(-1);
  const local = await (await page.request.get('/api/tasks/' + taskId)).json();
  const actual = await (await request.get(`${external}/operations/${local.operationId}`)).json();
  expect(actual.executions).toBe(1);
  expect(actual.result.status).toBe('SUCCEEDED');
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'operator');
  await page.goto(taskPath);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Обнаружено расхождение', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к разбору и решению' }).click();
  const issuePath = new URL(page.url()).pathname;
  await page.getByRole('link', { name: 'Разбор обмена', exact: true }).click();
  const row = page.locator('[data-record-id]').filter({ hasText: title });
  await expect(row).toContainText(reference);
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(issuePath + '$'));
  const actions = page.getByRole('region', { name: 'Действия оператора', exact: true });
  const evidence = page.getByRole('region', { name: 'Диагностика первого события', exact: true });
  await expect(evidence).toContainText('Сохранённые данные на момент ошибки');
  await expect(page.getByRole('link', { name: 'Открыть последнюю сверку', exact: true })).toHaveCount(1);
  await expect(actions.getByRole('button', { name: 'Применить решение', exact: true })).toBeDisabled();
  const panels = await page.locator('.issue-workspace').evaluate((el) =>
    Array.from(el.children).map((child) => {
      const { top, bottom, left, right } = child.getBoundingClientRect();
      return { top, bottom, left, right };
    }),
  );
  if (info.project.name === 'desktop') {
    expect(panels[1].left).toBeGreaterThan(panels[0].right);
    expect(panels[1].top).toBe(panels[0].top);
  } else expect(panels[1].top).toBeGreaterThan(panels[0].bottom);
  const operator = await (await page.request.get('/api/session')).json();
  await page.getByRole('button', { name: 'Взять разбор', exact: true }).click();
  await expect(page.getByText(operator.userId, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Взять разбор', exact: true })).toHaveCount(0);
  await selectChoice(page, 'Действие', 'Принять внешний результат');
  await expect(actions).toContainText('Результат выбранной сверки будет применён к заданию');
  await page
    .getByLabel('Причина решения *', { exact: true })
    .fill('Проверено фактическое исполнение, принимаю сохранённый результат');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/exchange/issues/*/resolve', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Принять внешний результат', exact: true }).click();
    await expect(page.getByRole('form', { name: 'Решение оператора', exact: true })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(page.getByRole('combobox', { name: 'Действие', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Причина решения *', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Сохраняем решение…', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('region', { name: 'Решение', exact: true })).toContainText(
    'Проверено фактическое исполнение',
  );
  await expect(page.getByRole('region', { name: 'Действия оператора', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть задание и историю' }).click();
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть сохранённую сверку', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка' })).toBeVisible();
  await expect(page.locator('.comparison-grid .snapshot').first()).toContainText('Ожидает исполнения');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const history = await (await page.request.get(`/api/tasks/${taskId}/history`)).json();
  expect(
    history.items.filter(
      (event: { type: string; actor: string }) => event.type === 'ISSUE_RESOLVED' && event.actor === 'USER',
    ),
  ).toHaveLength(1);
});

test('TC-06 / TC-07: conflicting external input is stopped explicitly without accepting its result', async ({
  page,
  request,
}, info) => {
  const reference = info.project.name === 'mobile' ? 'REQ-820002' : 'REQ-820001';
  await request.delete(`${external}/test/faults/${reference}`);
  expect((await request.put(`${external}/test/faults/${reference}`, { data: { mode: 'UNAVAILABLE' } })).status()).toBe(
    204,
  );
  await login(page);
  const csrf = await (await page.request.get('/api/csrf')).json();
  const created = await page.request.post('/api/tasks', {
    headers: { 'X-CSRF-TOKEN': csrf.token, 'Idempotency-Key': crypto.randomUUID() },
    data: { title: 'E2E ошибка протокола ' + crypto.randomUUID(), request: { reference, quantity: 25 } },
  });
  expect(created.status()).toBe(201);
  const { taskId } = await created.json();
  const initial = await (await page.request.get('/api/tasks/' + taskId)).json();
  expect(
    (
      await request.put(`${external}/operations/${initial.operationId}`, {
        data: { reference: 'REQ-829999', quantity: 25 },
      })
    ).status(),
  ).toBe(202);
  await expect
    .poll(async () => (await (await page.request.get('/api/tasks/' + taskId)).json()).deliveryStatus)
    .toBe('NEEDS_REVIEW');
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'operator');
  await page.goto('/tasks/' + taskId);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Обнаружено расхождение' })).toBeVisible();
  await page.getByRole('link', { name: 'Перейти к разбору и решению' }).click();
  await expect(page.getByRole('option', { name: 'Принять внешний результат', exact: true })).toHaveCount(0);
  await selectChoice(page, 'Действие', 'Завершить разбор');
  await page
    .getByLabel('Причина решения *', { exact: true })
    .fill('ID занят операцией с другим запросом, прекращаю отправку');
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён' })).toBeVisible();
  await page.getByRole('link', { name: 'Открыть задание и историю' }).click();
  await expect(page.getByText('Отправка остановлена', { exact: true })).toBeVisible();
  await expect(page.getByText('Ожидает исполнения', { exact: true })).toBeVisible();
});

test('SI-10: exhausted delivery resumes only after a fresh operator decision', async ({ page, request }, info) => {
  test.setTimeout(60_000);
  const resources = loadUiEnvironment();
  const postgres = resources.find((item: { service: string }) => item.service === 'postgres')!;
  const reference = info.project.name === 'mobile' ? 'REQ-850002' : 'REQ-850001';
  expect((await request.put(external + '/test/faults/' + reference, { data: { mode: 'UNAVAILABLE' } })).status()).toBe(
    204,
  );
  await login(page);
  await page.getByRole('link', { name: 'Создать задание' }).click();
  const title = 'E2E лимит ' + crypto.randomUUID();
  await page.getByLabel('Название *', { exact: true }).fill(title);
  await page.getByLabel('Номер заявки *', { exact: true }).fill(reference);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const taskId = new URL(page.url()).pathname.split('/').at(-1)!;
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
  const sql = (query: string) =>
    execFileSync(
      'docker',
      [
        'exec',
        postgres.containerId,
        'psql',
        '-XqAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'si_admin',
        '-d',
        'si_test',
        '-c',
        query,
      ],
      { encoding: 'utf8' },
    ).trim();
  // Advance only this owned fixture's due time; the worker still owns counters and transitions.
  await expect
    .poll(
      async () => {
        sql(
          "UPDATE delivery_queue SET due_at=clock_timestamp() WHERE operation_id=(SELECT operation_id FROM tasks WHERE id='" +
            taskId +
            "') AND claim_id IS NULL",
        );
        return (await (await page.request.get('/api/tasks/' + taskId)).json()).deliveryStatus;
      },
      { timeout: 25_000, intervals: [200] },
    )
    .toBe('NEEDS_REVIEW');
  expect(
    sql(
      "SELECT attempts||':'||automatic_attempts FROM delivery_queue WHERE operation_id=(SELECT operation_id FROM tasks WHERE id='" +
        taskId +
        "')",
    ),
  ).toBe('5:5');
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await login(page, 'operator');
  await page.goto('/tasks/' + taskId);
  const task = await (await page.request.get('/api/tasks/' + taskId)).json();
  const issues = await (await page.request.get('/api/exchange/issues?status=OPEN')).json();
  const issue = issues.items.find((item: { taskId: string }) => item.taskId === taskId);
  expect(issue).toBeTruthy();
  await page.goto('/issues/' + issue.issueId);
  await expect(
    page.getByText('Автоматическая доставка приостановлена: исчерпан лимит 5 попыток', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Действие', exact: true })).toHaveCount(0);
  expect((await request.delete(external + '/test/faults/' + reference)).status()).toBe(204);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await page.getByRole('link', { name: 'Перейти к разбору и решению' }).click();
  await selectChoice(page, 'Действие', 'Повторить обмен');
  await page
    .getByLabel('Причина решения *', { exact: true })
    .fill('Связь восстановлена, отсутствие операции проверено');
  const retryResponse = page.waitForResponse(
    (response) => response.url().endsWith('/retry') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Повторить обмен', exact: true }).click();
  expect((await retryResponse).status()).toBe(200);
  await page.goto('/tasks/' + taskId);
  await expect(page.getByText('Выполнено', { exact: true })).toBeVisible();
  const final = await (await page.request.get('/api/tasks/' + taskId)).json();
  expect(final.operationId).toBe(task.operationId);
  expect((await (await request.get(external + '/operations/' + task.operationId)).json()).executions).toBe(1);
  expect(
    sql(
      "SELECT string_agg(number::text,',' ORDER BY number) FROM delivery_attempts WHERE operation_id='" +
        task.operationId +
        "'",
    ),
  ).toBe('1,2,3,4,5,6,7');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
