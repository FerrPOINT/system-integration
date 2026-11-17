import { expect, test, type Page } from '@playwright/test';
import { openAccountMenu, selectChoice } from '../e2e/support';

const taskId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000010';
async function mockApi(page: Page, role = 'INITIATOR') {
  const state = {
    title: 'Original task',
    signedIn: true,
    accountId: '00000000-0000-4000-8000-000000000003',
    username: 'fixture',
    rejectHeldWrite: false,
    failRead: false,
    emptyIssues: false,
    issueReads: [] as string[],
    failSession: false,
    failCsrf: false,
    rejectLogin: false,
    loseWrite: false,
    commands: [] as { method: string; key: string | undefined; body: unknown }[],
    logins: 0,
    logouts: 0,
    assigned: false,
    decisionAvailable: true,
    evidenceReason: undefined as string | undefined,
    externalResultAvailable: false,
    resolved: false,
    generalIssue: false,
    revision: 1,
    latestSnapshot: snapshotId,
    role,
    rejectCreate: false,
    badCreateReceipt: undefined as unknown,
    badSnapshotReceipt: undefined as unknown,
    reconciliationStatus: 200,
    createKeys: new Set<string>(),
    holdWrite: undefined as Promise<void> | undefined,
    holdCsrf: undefined as Promise<void> | undefined,
    holdCsrfAt: undefined as number | undefined,
    csrfReads: 0,
    holdLogout: undefined as Promise<void> | undefined,
    sessionCookie: false,
    holdRead: undefined as Promise<void> | undefined,
    rejectRename: false,
    reads: [] as string[],
  };
  const task = () => ({
    taskId,
    operationId: taskId,
    ownerId: '00000000-0000-4000-8000-000000000003',
    title: state.title,
    titleRevision: 1,
    request: { reference: 'REQ-000001', quantity: 25 },
    createdAt: '2026-11-14T00:00:00Z',
    deliveryStatus: 'ACKNOWLEDGED',
    businessStatus: 'SUCCEEDED',
    result: { status: 'SUCCEEDED', completedAt: '2026-11-14T00:00:00Z' },
  });
  const snapshot = () => ({
    reconciliationId: snapshotId,
    taskId,
    issueId: taskId,
    operationId: taskId,
    checkedAt: '2026-11-14T00:00:00Z',
    checkedBy: task().ownerId,
    outcome: 'UNAVAILABLE',
    local: { request: task().request, deliveryStatus: task().deliveryStatus, businessStatus: task().businessStatus },
    externalAvailability: 'UNAVAILABLE',
  });
  const issue = () => ({
    issueId: taskId,
    taskId: state.generalIssue ? undefined : taskId,
    operationId: taskId,
    issueRevision: state.revision,
    kind: 'RECONCILIATION_DIFFERENCE',
    status: state.resolved ? 'RESOLVED' : 'OPEN',
    summary: 'Fixture discrepancy',
    evidence: state.evidenceReason ? { reason: state.evidenceReason } : undefined,
    taskTitle: state.title,
    requestReference: 'REQ-000001',
    openedAt: '2026-11-14T00:00:00Z',
    latestReconciliationId: state.generalIssue ? undefined : state.latestSnapshot,
    assignedTo: state.assigned ? task().ownerId : undefined,
    allowedActions: state.resolved
      ? []
      : state.generalIssue
        ? ['ACKNOWLEDGE_FEED_ISSUE']
        : [
            ...(state.assigned ? [] : ['TAKE_OWNERSHIP']),
            'RECONCILE',
            ...(state.decisionAvailable ? ['ACKNOWLEDGE_DIFFERENCE'] : []),
            ...(state.externalResultAvailable ? ['APPLY_EXTERNAL_RESULT'] : []),
          ],
    resolution: state.resolved
      ? {
          issueId: taskId,
          action: state.generalIssue ? 'ACKNOWLEDGE_FEED_ISSUE' : 'ACKNOWLEDGE_DIFFERENCE',
          reason: 'Verified fixture',
          reconciliationId: state.generalIssue ? undefined : snapshotId,
          decidedAt: '2026-11-14T00:00:00Z',
          decidedBy: task().ownerId,
        }
      : undefined,
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const fail = () => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Gateway failure</html>' });
      if (path === '/api/csrf') {
        state.csrfReads++;
        if (state.holdCsrfAt === undefined || state.holdCsrfAt === state.csrfReads) await state.holdCsrf;
        return state.failCsrf
          ? fail()
          : route.fulfill({ json: { token: 'fixture', userId: state.signedIn ? state.accountId : null } });
      }
      if (path === '/api/session')
        return state.failSession
          ? fail()
          : route.fulfill({
              status: state.signedIn ? 200 : 401,
              json: state.signedIn
                ? { userId: state.accountId, username: state.username, role: state.role }
                : { code: 'SESSION_REQUIRED' },
            });
      if (path === '/api/login') {
        state.logins++;
        if (state.rejectLogin) return route.fulfill({ status: 401, json: { code: 'INVALID_CREDENTIALS' } });
        state.signedIn = true;
        return route.fulfill({
          status: 204,
          headers: state.sessionCookie ? { 'set-cookie': 'JSESSIONID=fixture-renewed; Path=/; SameSite=Lax' } : {},
        });
      }
      if (path === '/api/logout') {
        state.signedIn = false;
        state.logouts++;
        state.failCsrf = true;
        await state.holdLogout;
        return route.fulfill({
          status: 204,
          headers: state.sessionCookie ? { 'set-cookie': 'JSESSIONID=; Max-Age=0; Path=/' } : {},
        });
      }
      if (['POST', 'PATCH'].includes(request.method())) {
        state.commands.push({
          method: request.method(),
          key: request.headers()['idempotency-key'],
          body: request.postDataJSON(),
        });
        if (request.method() === 'PATCH' && state.rejectRename)
          return route.fulfill({
            status: 409,
            json: { code: 'TITLE_REVISION_CONFLICT', detail: 'Fixture title conflict' },
          });
        if (path === '/api/tasks' && state.rejectCreate)
          return route.fulfill({
            status: 400,
            json: { code: 'INVALID_REQUEST', detail: 'Fixture validation rejection' },
          });
        await state.holdWrite;
        if (state.rejectHeldWrite) return route.fulfill({ status: 401, json: { code: 'SESSION_REQUIRED' } });
        if (path === '/api/tasks') state.createKeys.add(request.headers()['idempotency-key']);
        if (request.postDataJSON()?.title) state.title = request.postDataJSON().title;
        if (state.loseWrite) {
          state.loseWrite = false;
          return route.abort('failed');
        }
        if (path === '/api/tasks' && state.badCreateReceipt !== undefined)
          return route.fulfill({ status: 201, json: state.badCreateReceipt });
        if (path.endsWith('/reconciliations') && state.badSnapshotReceipt !== undefined)
          return route.fulfill({ json: state.badSnapshotReceipt });
        if (path.endsWith('/reconciliations') && state.reconciliationStatus !== 200)
          return route.fulfill({
            status: state.reconciliationStatus,
            json: {
              type: 'about:blank',
              status: state.reconciliationStatus,
              code: state.reconciliationStatus === 404 ? 'TASK_NOT_FOUND' : 'SERVICE_UNAVAILABLE',
              title: state.reconciliationStatus === 404 ? 'Задание не найдено' : 'Сервис недоступен',
            },
          });
        state.failRead = true;
        if (path.endsWith('/take')) {
          state.assigned = true;
          return route.fulfill({ json: issue() });
        }
        if (path.endsWith('/resolve')) {
          state.resolved = true;
          return route.fulfill({ json: issue().resolution });
        }
        if (path.endsWith('/reconciliations')) return route.fulfill({ json: snapshot() });
        return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: { taskId } });
      }
      state.reads.push(path);
      await state.holdRead;
      if (state.failRead) return fail();
      if (path === '/api/exchange/issues') {
        const search = new URL(request.url()).searchParams;
        state.issueReads.push(search.toString());
        const number = Number(search.get('page') ?? 0),
          size = Number(search.get('size') ?? 20);
        const items = state.emptyIssues ? [] : [issue()];
        return route.fulfill({
          json: {
            items: items.slice(number * size, (number + 1) * size),
            page: number,
            totalItems: items.length,
            totalPages: Math.ceil(items.length / size),
            hasNext: false,
          },
        });
      }
      if (path === '/api/exchange/issues/' + taskId) return route.fulfill({ json: issue() });
      if (path.endsWith('/reconciliations/' + snapshotId)) return route.fulfill({ json: snapshot() });
      if (path.endsWith('/history'))
        return route.fulfill({ json: { items: [], page: 0, hasNext: false, totalItems: 0, totalPages: 0 } });
      if (path === '/api/tasks')
        return route.fulfill({ json: { items: [task()], page: 0, hasNext: false, totalItems: 1, totalPages: 1 } });
      if (path === '/api/tasks/' + taskId) return route.fulfill({ json: task() });
      throw new Error('Unexpected fixture API request: ' + path);
    },
  );
  return state;
}

const settledCommands = (page: Page) =>
  page.evaluate(() => {
    const fixture = window as unknown as {
      fixtureFailedCommands: () => number;
      fixtureSuccessfulCommands: () => number;
    };
    return fixture.fixtureFailedCommands() + fixture.fixtureSuccessfulCommands();
  });

for (const action of ['Создать', 'Переименовать', 'Сверить', 'Взять', 'Решить', 'Повторить обмен']) {
  for (const changed of [false, true]) {
    test(`session preflight ${action} ${changed ? 'rejects a changed identity' : 'allows a same-identity refetch'}`, async ({
      page,
    }) => {
      const state = await mockApi(page, ['Создать', 'Переименовать'].includes(action) ? 'INITIATOR' : 'OPERATOR');
      let release!: () => void;
      state.holdCsrf = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.goto('/tests/command-outcome.html?screen=probe');
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect.poll(() => state.csrfReads).toBe(1);
      if (changed) state.accountId = '00000000-0000-4000-8000-000000000099';
      state.username = 'renewed';
      await refetchSession(page);
      await expect(page.getByText('Текущий пользователь: renewed', { exact: true })).toBeVisible();
      release();
      await expect.poll(() => settledCommands(page)).toBe(1);
      expect(state.commands).toHaveLength(changed ? 0 : 1);
      if (changed) {
        state.holdCsrf = undefined;
        await page.getByRole('button', { name: action, exact: true }).click();
        await expect.poll(() => state.commands.length).toBe(1);
        await expect.poll(() => settledCommands(page)).toBe(2);
      }
    });
  }
}

async function holdSessionLock(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((entered) => {
        void navigator.locks.request(
          'system-integration-session-cookie',
          () =>
            new Promise<void>((release) => {
              Object.assign(window, { fixtureReleaseSessionLock: release });
              entered();
            }),
        );
      }),
  );
  return () =>
    page.evaluate(() => (window as unknown as { fixtureReleaseSessionLock: () => void }).fixtureReleaseSessionLock());
}

test('a changed cookie owner cannot submit a stale form before session refetch', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html?screen=probe');
  await expect(page.getByText('Текущий пользователь: fixture', { exact: true })).toBeVisible();
  state.accountId = '00000000-0000-4000-8000-000000000099';
  state.username = 'renewed';
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect.poll(() => settledCommands(page)).toBe(1);
  expect(state.commands).toHaveLength(0);
  await expect(page.getByText('Текущий пользователь: renewed', { exact: true })).toBeVisible();
});

for (const action of ['login', 'logout']) {
  test(`queued session ${action} cannot write after identity changes`, async ({ page }) => {
    const state = await mockApi(page);
    state.signedIn = action === 'logout';
    await page.goto('/tests/command-outcome.html?screen=probe');
    await expect(
      page.getByRole('heading', { name: action === 'login' ? 'Вход в систему' : 'Проверка команд', exact: true }),
    ).toBeVisible();
    const release = await holdSessionLock(page);
    try {
      if (action === 'login') {
        await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
        await page.getByLabel('Пароль *', { exact: true }).fill('fixture');
        await page.getByRole('button', { name: 'Войти', exact: true }).click();
      } else {
        await openAccountMenu(page);
        await page.getByRole('button', { name: 'Выйти', exact: true }).click();
      }
      await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0)).toBe(1);
      state.accountId = '00000000-0000-4000-8000-000000000099';
      state.username = 'renewed';
      state.signedIn = true;
      await refetchSession(page);
      await expect(page.getByText('Текущий пользователь: renewed', { exact: true })).toBeVisible();
      await release();
      await expect.poll(() => settledCommands(page)).toBe(1);
      expect(state.logins).toBe(0);
      expect(state.logouts).toBe(0);
      await expect(page.getByText('Текущий пользователь: renewed', { exact: true })).toBeVisible();
    } finally {
      await release();
    }
  });
}

test('login remains usable after a rejected credential attempt changes the session generation', async ({ page }) => {
  const state = await mockApi(page);
  state.signedIn = false;
  state.rejectLogin = true;
  await page.goto('/tests/command-outcome.html?screen=probe');
  await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
  await page.getByLabel('Пароль *', { exact: true }).fill('fixture');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль');
  state.rejectLogin = false;
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проверка команд', exact: true })).toBeVisible();
  expect(state.logins).toBe(2);
});

test('overlapping identical creates keep one key while the second CSRF waits', async ({ page }) => {
  const state = await mockApi(page);
  let release!: () => void;
  state.holdCsrfAt = 2;
  state.holdCsrf = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/tests/command-outcome.html?screen=probe');
  await page.getByRole('button', { name: 'Дважды создать', exact: true }).click();
  await expect.poll(() => state.csrfReads).toBe(2);
  await expect.poll(() => settledCommands(page)).toBe(1);
  release();
  await expect.poll(() => settledCommands(page)).toBe(2);
  expect(state.commands).toHaveLength(2);
  expect(state.createKeys.size).toBe(1);
});

for (const identity of ['same account', 'other account']) {
  test('late logout success preserves a new session for ' + identity, async ({ page }) => {
    const state = await mockApi(page);
    let release!: () => void;
    state.holdLogout = new Promise<void>((resolve) => {
      release = resolve;
    });
    const successes = () =>
      page.evaluate(() =>
        (window as unknown as { fixtureSuccessfulCommands: () => number }).fixtureSuccessfulCommands(),
      );
    await page.goto('/tests/command-outcome.html');
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect.poll(() => state.logouts).toBe(1);
    await refetchSession(page);
    await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
    state.failCsrf = false;
    if (identity === 'other account') {
      state.accountId = '00000000-0000-4000-8000-000000000099';
      state.role = 'OPERATOR';
    }
    state.username = 'renewed';
    // A session established elsewhere is observed before this tab receives its old logout response.
    state.signedIn = true;
    await refetchSession(page);
    await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
    await expect.poll(successes).toBe(0);
    if (identity === 'same account') {
      await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
      await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('New session draft');
    }
    release();
    await expect.poll(successes).toBe(1);
    await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
    if (identity === 'same account')
      await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toHaveValue('New session draft');
    expect(
      await page.evaluate(() =>
        (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount(),
      ),
    ).toBeGreaterThan(0);
    expect(state.commands).toHaveLength(0);
  });
}

test('a delayed logout cannot erase the login cookie of another tab', async ({ page, context }) => {
  const old = await mockApi(page);
  old.sessionCookie = true;
  let release!: () => void;
  old.holdLogout = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/tests/command-outcome.html');
  await openAccountMenu(page);
  const logout = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/logout');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect.poll(() => old.logouts).toBe(1);

  const other = await context.newPage();
  const renewed = await mockApi(other);
  renewed.signedIn = false;
  renewed.sessionCookie = true;
  await other.goto('/tests/command-outcome.html');
  await other.getByRole('textbox', { name: 'Логин', exact: true }).fill('renewed');
  await other.getByLabel('Пароль *', { exact: true }).fill('fixture');
  const login = other.waitForResponse((response) => new URL(response.url()).pathname === '/api/login');
  await other.getByRole('button', { name: 'Войти', exact: true }).click();
  // With serialization the login is queued; without it the server has already set the new cookie.
  await Promise.any([
    login,
    other.waitForFunction(async () =>
      (await navigator.locks.query()).pending?.some((lock) => lock.name === 'system-integration-session-cookie'),
    ),
  ]);
  release();
  await Promise.all([logout, login]);
  await expect(other.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  await expect
    .poll(async () => (await context.cookies()).find((cookie) => cookie.name === 'JSESSIONID')?.value)
    .toBe('fixture-renewed');
  expect(old.logouts).toBe(1);
  expect(renewed.logins).toBe(1);
  await other.close();
});

for (const command of ['login', 'logout']) {
  test('unsupported cookie coordination reports an error without sending ' + command, async ({ page }) => {
    const state = await mockApi(page);
    state.signedIn = command === 'logout';
    await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await page.goto('/tests/command-outcome.html');
    if (command === 'login') {
      await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
      await page.getByLabel('Пароль *', { exact: true }).fill('fixture');
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
    } else {
      await openAccountMenu(page);
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    }
    await expect(page.getByRole('alert').filter({ hasText: 'Для безопасной смены сессии' })).toBeVisible();
    expect(state.logins).toBe(0);
    expect(state.logouts).toBe(0);
  });
}

test('logout read failure remains visible in the active account controls', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  state.failCsrf = true;
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось выполнить запрос' })).toBeVisible();
  expect(state.logouts).toBe(0);
  if (test.info().project.name === 'mobile') {
    await expect(page.getByRole('dialog', { name: 'Меню приложения' }).getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось выполнить запрос' })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
});

for (const exit of ['route', 'logout']) {
  test('failed conflict refresh keeps the rename departure guard for ' + exit, async ({ page }) => {
    const state = await mockApi(page);
    state.rejectRename = true;
    await page.goto('/tests/command-outcome.html');
    await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
    const title = page.getByRole('textbox', { name: 'Новое название', exact: true });
    await title.fill('Conflicting title');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Fixture title conflict' })).toBeVisible();
    state.failRead = true;
    await page.getByRole('button', { name: 'Обновить карточку', exact: true }).click();
    await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Повторить обновление', exact: true })).toBeVisible();
    await title.fill('Draft after failed refresh');
    await expect(page.getByRole('alert').filter({ hasText: 'Название сохранено.' })).toHaveCount(0);
    if (exit === 'route') await page.evaluate(() => (window as unknown as { fixtureBack: () => void }).fixtureBack());
    else {
      await openAccountMenu(page);
      await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    }
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
    if (exit === 'logout' && test.info().project.name === 'mobile')
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(title).toHaveValue('Draft after failed refresh');
    expect(state.logouts).toBe(0);
    state.failRead = false;
    await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
    await expect(title).toHaveValue('Draft after failed refresh');
    await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
    await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
    await expect(title).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
    expect(state.commands).toHaveLength(1);
  });
}

test('conflict recovery freezes the rename fields until the read closes the form', async ({ page }) => {
  const state = await mockApi(page);
  state.rejectRename = true;
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Новое название', exact: true });
  await title.fill('Conflicting title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const update = page.getByRole('button', { name: 'Обновить карточку', exact: true });
  await expect(update).toBeVisible();
  let release!: () => void;
  state.holdRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  await update.click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(title).toBeDisabled();
  await expect(update).toBeDisabled();
  release();
  await expect(title).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

for (const general of [false, true]) {
  test(
    'an accepted decision closes the form and preserves read recovery for ' + (general ? 'feed' : 'task'),
    async ({ page }) => {
      const state = await mockApi(page, 'OPERATOR');
      state.generalIssue = general;
      state.assigned = true;
      await page.goto('/tests/command-outcome.html?screen=issue');
      const label = general ? 'Закрыть общую проблему' : 'Завершить разбор';
      const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
      await reason.fill('Accepted decision');
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
      await expect(reason).toHaveCount(0);
      await expect(page.getByRole('form', { name: 'Решение оператора' })).toHaveCount(0);
      expect(state.commands).toHaveLength(1);
      state.failRead = false;
      await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
      await expect(reason).toHaveCount(0);
      expect(state.commands).toHaveLength(1);
    },
  );
}

test('accepted rename and repeated read failures never resubmit PATCH', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Accepted title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Название сохранено.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toBeDisabled();
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('button', { name: 'Повторить обновление' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Accepted title', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
});

test('accepted reconciliation retries reads and opens the same saved snapshot', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html');
  const start = page.getByRole('button', { name: 'Выполнить сверку', exact: true });
  await expect(start).toBeVisible();
  let releaseRead!: () => void;
  state.holdRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  try {
    await start.click();
    await expect(page.getByRole('status').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
    await expect(start).toHaveCount(0);
    expect(state.commands).toHaveLength(1);
  } finally {
    releaseRead();
  }
  await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
  await expect(start).toHaveCount(0);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

test('accepted ownership is not repeated to recover a failed issue read', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('button', { name: 'Взять разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ответственный назначен.' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('button', { name: 'Перенять разбор', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Ответственный назначен.' })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
});

test('single decision needs only a reason and has no extra form action', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  const form = page.getByRole('form', { name: 'Решение оператора', exact: true });
  const reason = form.getByRole('textbox', { name: 'Причина решения', exact: true });
  const submit = form.getByRole('button', { name: 'Завершить разбор', exact: true });
  await expect(form.getByRole('combobox', { name: 'Действие', exact: true })).toHaveCount(0);
  await expect(form).toContainText('Результат в приложении сохранится.');
  await expect(submit).toBeDisabled();
  await reason.fill('Unsaved decision');
  await expect(submit).toBeEnabled();
  await expect(form.getByRole('button')).toHaveCount(1);
  const widths = test.info().project.name === 'mobile' ? [390, 320] : [1440, 1000];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await reason.fill('');
  await expect(submit).toBeDisabled();
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});

test('decision requires a choice only while several actions are available', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.externalResultAvailable = true;
  await page.goto('/tests/command-outcome.html?screen=issue');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Verified external result');
  await expect(page.getByRole('button', { name: 'Сохранить решение', exact: true })).toBeDisabled();
  await selectChoice(page, 'Действие', 'Принять внешний результат');
  const accept = page.getByRole('button', { name: 'Принять внешний результат', exact: true });
  await expect(accept).toBeEnabled();

  state.externalResultAvailable = false;
  state.revision = 2;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Действие', exact: true })).toHaveCount(0);
  await expect(accept).toBeDisabled();
  expect(state.commands).toHaveLength(0);

  await page.getByRole('button', { name: 'Использовать актуальные данные' }).click();
  await expect(reason).toHaveValue('Verified external result');
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  expect(state.commands.map((command) => command.body)).toEqual([
    {
      expectedIssueRevision: 2,
      reconciliationId: snapshotId,
      action: 'ACKNOWLEDGE_DIFFERENCE',
      reason: 'Verified external result',
    },
  ]);
});

test('operator decision draft allows departure without a confirmation or command', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('textbox', { name: 'Причина решения', exact: true }).fill('Unsubmitted explanation');
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});

test('operator decision blocks departure only while the submitted command is pending', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  let release = () => {};
  state.holdWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/tests/command-outcome.html?screen=issue');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Submitted decision');
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  try {
    await expect(page.getByRole('button', { name: 'Сохраняем решение…', exact: true })).toBeDisabled();
    await page.getByRole('link', { name: 'Задания', exact: true }).click();
    await expect(reason).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  state.failRead = false;
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

test('issue diagnostics and operator actions have equal cards on wide screens and stack on narrow screens', async ({
  page,
}) => {
  const state = await mockApi(page, 'OPERATOR');
  state.evidenceReason = 'Подробности первого события. '.repeat(70);
  await page.goto('/tests/command-outcome.html?screen=issue');
  const diagnostics = page.getByRole('region', { name: 'Диагностика первого события', exact: true });
  const actions = page.getByRole('region', { name: 'Действия оператора', exact: true });
  await expect(diagnostics).toBeVisible();
  await expect(actions).toBeVisible();
  const widths = test.info().project.name === 'desktop' ? [1440, 1024, 901, 900] : [390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    const a = (await diagnostics.boundingBox())!;
    const b = (await actions.boundingBox())!;
    expect(a.width).toBeCloseTo(b.width, 0);
    if (width > 900) {
      expect(a.y).toBeCloseTo(b.y, 0);
      expect(a.height).toBeCloseTo(b.height, 0);
      expect(b.x).toBeGreaterThan(a.x + a.width);
    } else {
      expect(a.x).toBeCloseTo(b.x, 0);
      expect(b.y).toBeGreaterThan(a.y + a.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('refetch preserves a decision draft and requires explicit adoption of the new basis', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('textbox', { name: 'Причина решения', exact: true }).fill('Preserved explanation');
  state.revision = 2;
  state.latestSnapshot = 'new-snapshot';
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Введённая причина осталась в форме.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Причина решения', exact: true })).toHaveValue(
    'Preserved explanation',
  );
  await expect(page.getByRole('button', { name: 'Завершить разбор', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Использовать актуальные данные' }).click();
  await page.getByRole('button', { name: 'Завершить разбор', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].body).toEqual({
    expectedIssueRevision: 2,
    reconciliationId: 'new-snapshot',
    action: 'ACKNOWLEDGE_DIFFERENCE',
    reason: 'Preserved explanation',
  });
});

test('external resolution keeps an unsubmitted draft until the operator clears the reason', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=issue');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Unsubmitted explanation');
  state.resolved = true;
  state.revision = 2;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  await expect(reason).toHaveValue('Unsubmitted explanation');
  await expect(page.getByRole('alert').filter({ hasText: 'Введённая причина осталась в форме.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Завершить разбор', exact: true })).toBeDisabled();
  await reason.fill('');
  await expect(reason).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});

test('a screen render failure preserves the shell and recovers through the actual route tree', async ({ page }) => {
  await mockApi(page);
  await page.route(
    (url) => url.pathname === '/api/tasks/' + taskId,
    (route) => route.fulfill({ json: { taskId, title: 'Malformed task' } }),
  );
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Не удалось открыть страницу', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Cannot read properties');
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
});

test('initiator route gate redirects before reading operator data', async ({ page }) => {
  const state = await mockApi(page);
  const operatorReads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/exchange/')) operatorReads.push(request.url());
  });
  await page.goto('/tests/command-outcome.html?screen=issue');
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
  expect(operatorReads).toEqual([]);
  expect(state.commands).toEqual([]);
});

test('operator cannot open the initiator create dialog through a direct URL', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  await page.goto('/tests/command-outcome.html?screen=new');
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Новое задание', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Создать задание', exact: true })).toHaveCount(0);
  expect(state.commands).toEqual([]);
});

test('unknown URLs have a regular not-found screen under the shell', async ({ page }) => {
  await mockApi(page);
  await page.goto('/tests/command-outcome.html?screen=missing');
  await expect(page.getByRole('heading', { name: 'Страница не найдена', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'К заданиям', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои задания', exact: true })).toBeVisible();
});

test('unknown rename outcome repeats the original input and idempotency key', async ({ page }) => {
  const state = await mockApi(page);
  state.loseWrite = true;
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Retry same title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Название сохранено.' })).toBeVisible();
  expect(state.commands).toHaveLength(2);
  expect(state.commands[0].key).toBeTruthy();
  expect(state.commands[1]).toEqual(state.commands[0]);
});

test('accepted create offers only read recovery after a failed follow-up', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html?screen=list');
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Created task');
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-000002');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Задание создано.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать', exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Created task', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

async function openCreate(page: Page, title: string) {
  await page.goto('/tests/command-outcome.html?screen=list');
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-456789');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
}

const refetchSession = (page: Page) =>
  page.evaluate(() => (window as unknown as { fixtureRefetchSession: () => Promise<void> }).fixtureRefetchSession());

test('late mutation 401 cannot expire a newly accepted account', async ({ page }) => {
  const state = await mockApi(page);
  let release!: () => void;
  state.holdWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Pending old account');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  state.accountId = '00000000-0000-4000-8000-000000000004';
  state.role = 'OPERATOR';
  state.username = 'second-account';
  await refetchSession(page);
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Меню приложения' }).click();
  await expect(page.getByText('second-account', { exact: false })).toBeVisible();
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  state.rejectHeldWrite = true;
  release();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { fixtureFailedCommands: () => number }).fixtureFailedCommands()),
    )
    .toBe(1);
  await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  state.holdWrite = undefined;
  state.signedIn = false;
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
});

for (const receipt of [
  {},
  { reconciliationId: 7 },
  { reconciliationId: snapshotId, taskId: 'other-task' },
  { reconciliationId: snapshotId, taskId, issueId: 'bad-issue' },
]) {
  test('malformed reconciliation preserves the original command ' + JSON.stringify(receipt), async ({ page }) => {
    const state = await mockApi(page, 'OPERATOR');
    state.badSnapshotReceipt = receipt;
    await page.goto('/tests/command-outcome.html');
    await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
    expect(state.reads.some((path) => path.includes('/reconciliations/'))).toBe(false);
    state.badSnapshotReceipt = undefined;
    await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
    state.failRead = false;
    await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
    expect(state.commands).toHaveLength(2);
    expect(state.commands[0].key).toBeTruthy();
    expect(state.commands[1]).toEqual(state.commands[0]);
  });
}

for (const screen of ['', 'issue', 'reconciliation']) {
  test(
    'reconciliation departure protects pending and uncertain commands on ' + (screen || 'task'),
    async ({ page }) => {
      const state = await mockApi(page, 'OPERATOR');
      let release!: () => void;
      state.holdWrite = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.badSnapshotReceipt = {};
      await page.goto('/tests/command-outcome.html?screen=' + screen);
      await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
      await expect.poll(() => state.commands.length).toBe(1);
      await page.getByRole('link', { name: 'Задания', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Сверяем…', exact: true })).toBeDisabled();
      release();
      await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
      const nativeProtected = await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
      expect(nativeProtected).toBe(true);
      await page.evaluate(() => (window as unknown as { fixtureBack: () => void }).fixtureBack());
      await expect(page.getByRole('alertdialog', { name: 'Уйти без проверки сверки?' })).toBeVisible();
      await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Проверить результат сверки', exact: true })).toBeFocused();
      state.badSnapshotReceipt = undefined;
      await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
      if (screen === 'reconciliation') {
        // No active task/issue read exists here; accepted recovery can finish without a failing GET.
        await expect(page.getByRole('button', { name: 'Выполнить сверку', exact: true })).toBeEnabled();
      } else {
        await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
      }
      expect(state.commands).toHaveLength(2);
      expect(state.commands[1]).toEqual(state.commands[0]);
      state.failRead = false;
      await page.getByRole('link', { name: 'Задания', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    },
  );
}

test('an issue without decision fields still protects an uncertain reconciliation until explicit abandonment', async ({
  page,
}) => {
  const state = await mockApi(page, 'OPERATOR');
  state.decisionAvailable = false;
  state.badSnapshotReceipt = {};
  await page.goto('/tests/command-outcome.html?screen=issue');
  await expect(page.getByRole('form', { name: 'Решение оператора' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('потеряете возможность безопасно повторить');
  await page.getByRole('button', { name: 'Уйти без проверки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Все задания', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Original task', exact: true }).click();
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1].key).not.toBe(state.commands[0].key);
});

test('unresolved reconciliation prompts independently of an unsubmitted decision', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.badSnapshotReceipt = {};
  await page.goto('/tests/command-outcome.html?screen=issue');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  await reason.fill('Draft must survive reconciliation');
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
  await expect(page.getByRole('button', { name: 'Завершить разбор', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Задания', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(reason).toHaveValue('Draft must survive reconciliation');
  state.badSnapshotReceipt = undefined;
  await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Сохранённая сверка', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
});

test('a definitive reconciliation 404 remains a rejection', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.reconciliationStatus = 404;
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание не найдено');
  await expect(page.getByRole('button', { name: 'Выполнить сверку', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Проверить результат сверки', exact: true })).toHaveCount(0);
});

test('uncertain reconciliation stays uncertain through a failed CSRF read', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.reconciliationStatus = 503;
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
  state.failCsrf = true;
  await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверить результат сверки', exact: true })).toBeEnabled();
  expect(state.commands).toHaveLength(1);
  state.failCsrf = false;
  state.reconciliationStatus = 200;
  await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Сверка сохранена.' })).toBeVisible();
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1]).toEqual(state.commands[0]);
});

test('unknown create freezes the submitted input and replays exactly one command', async ({ page }) => {
  const state = await mockApi(page);
  state.loseWrite = true;
  await openCreate(page, 'Uncertain create');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  state.failSession = true;
  await refetchSession(page);
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toHaveValue('Uncertain create');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  state.failSession = false;
  await refetchSession(page);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Задание могло сохраниться');
  await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить исходную отправку', exact: true })).toBeFocused();
  state.failCsrf = true;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  expect(state.commands).toHaveLength(1);
  state.failCsrf = false;
  state.rejectCreate = true;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
  state.rejectCreate = false;
  await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(3);
  expect(state.commands[1]).toEqual(state.commands[0]);
  expect(state.commands[2]).toEqual(state.commands[0]);
  expect(state.createKeys.size).toBe(1);
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Uncertain create', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(3);
});

test('a failure before create dispatch leaves the form editable', async ({ page }) => {
  const state = await mockApi(page);
  state.failCsrf = true;
  await openCreate(page, 'Not dispatched');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeEnabled();
  expect(state.commands).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Edited before dispatch');
  state.failCsrf = false;
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].body).toMatchObject({ title: 'Edited before dispatch' });
});

test('leaving an uncertain create requires an explicit warning before a new command', async ({ page }) => {
  const state = await mockApi(page);
  state.loseWrite = true;
  await openCreate(page, 'Uncertain abandoned command');
  await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Задание могло сохраниться');
  await page.getByRole('button', { name: 'Закрыть без проверки', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Создать задание', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Deliberate new command');
  await page.getByRole('textbox', { name: 'Номер заявки', exact: true }).fill('REQ-567890');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.commands).toHaveLength(2);
  expect(state.commands[1].key).not.toBe(state.commands[0].key);
  expect(state.createKeys.size).toBe(2);
});

test('a definitive create rejection permits correcting the input', async ({ page }) => {
  const state = await mockApi(page);
  state.rejectCreate = true;
  await openCreate(page, 'Rejected create');
  await expect(page.getByRole('alert')).toContainText('Fixture validation rejection');
  await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Corrected create');
  state.rejectCreate = false;
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Задание создано.');
  expect(state.createKeys.size).toBe(1);
  expect(state.commands[1].body).toMatchObject({ title: 'Corrected create' });
  expect(state.commands[1].key).not.toBe(state.commands[0].key);
});

for (const receipt of [{}, { taskId: 12 }, { taskId: 'invalid-id' }]) {
  test('invalid create receipt retains the original command ' + JSON.stringify(receipt), async ({ page }) => {
    const state = await mockApi(page);
    state.badCreateReceipt = receipt;
    await openCreate(page, 'Receipt recovery');
    await expect(page.getByRole('alert')).toContainText('Результат отправки неизвестен');
    await expect(page.getByRole('textbox', { name: 'Название', exact: true })).toBeDisabled();
    expect(
      state.reads.some(
        (path) => path === '/api/tasks/undefined' || path === '/api/tasks/invalid-id' || path === '/api/tasks/12',
      ),
    ).toBe(false);
    expect(state.createKeys.size).toBe(1);
    state.badCreateReceipt = undefined;
    await page.getByRole('button', { name: 'Повторить исходную отправку', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Задание создано.');
    expect(state.commands[1]).toEqual(state.commands[0]);
    expect(state.createKeys.size).toBe(1);
  });
}

test('background session failure preserves a dirty form through recovery', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Новое название', exact: true });
  await title.fill('Keep session draft');
  state.failSession = true;
  await refetchSession(page);
  await expect(title).toHaveValue('Keep session draft');
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  state.failSession = false;
  await refetchSession(page);
  await expect(title).toHaveValue('Keep session draft');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('initial session failure has a read-only retry without showing private content', async ({ page }) => {
  const state = await mockApi(page);
  state.failSession = true;
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить название', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toHaveCount(0);
  state.failSession = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  expect(state.logins).toBe(0);
});

test('background session failure does not detach a pending command observer', async ({ page }) => {
  const state = await mockApi(page);
  let release!: () => void;
  state.holdWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Pending through session refresh');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  state.failSession = true;
  await refetchSession(page);
  await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toBeDisabled();
  state.failSession = false;
  await refetchSession(page);
  release();
  await expect(page.getByRole('region', { name: 'Состояние задания', exact: true }).getByRole('alert')).toContainText(
    'Название сохранено.',
  );
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending through session refresh', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
});

for (const identity of ['expired', 'role changed']) {
  test('session ' + identity + ' clears a private draft', async ({ page }) => {
    const state = await mockApi(page);
    await page.goto('/tests/command-outcome.html');
    await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
    await page.getByRole('textbox', { name: 'Новое название', exact: true }).fill('Private draft');
    if (identity === 'expired') state.signedIn = false;
    else state.role = 'OPERATOR';
    await refetchSession(page);
    await expect(page.getByRole('textbox', { name: 'Новое название', exact: true })).toHaveCount(0);
    if (identity === 'expired') {
      await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
      expect(
        await page.evaluate(() =>
          (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount(),
        ),
      ).toBe(0);
    } else await expect(page.getByRole('link', { name: 'Разбор обмена', exact: true })).toBeVisible();
  });
}

test('accepted logout clears private queries before any further token read', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: 'Меню приложения', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  expect(state.logouts).toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount()),
  ).toBe(0);
});

for (const screen of ['', 'issue', 'reconciliation']) {
  test('logout respects pending and uncertain reconciliation on ' + (screen || 'task'), async ({ page }) => {
    const state = await mockApi(page, 'OPERATOR');
    let release!: () => void;
    state.holdWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.badSnapshotReceipt = {};
    await page.goto('/tests/command-outcome.html?screen=' + screen);
    await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(1);
    await openAccountMenu(page);
    const logout = page.getByRole('button', { name: 'Выйти', exact: true });
    await expect(logout).toBeDisabled();
    expect(state.logouts).toBe(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    release();
    await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
    await openAccountMenu(page);
    await logout.click();
    await expect(page.getByRole('alertdialog', { name: 'Уйти без проверки сверки?' })).toBeVisible();
    expect(state.logouts).toBe(0);
    await page.getByRole('button', { name: 'Вернуться к проверке', exact: true }).click();
    await expect(logout).toBeFocused();
    if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    state.badSnapshotReceipt = undefined;
    await page.getByRole('button', { name: 'Проверить результат сверки', exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Сверяем…', exact: true })).toHaveCount(0);
    expect(state.commands[1]).toEqual(state.commands[0]);
    await openAccountMenu(page);
    await logout.click();
    await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
    expect(state.logouts).toBe(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
}

test('explicitly abandoning an uncertain reconciliation permits logout and clears private data', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.badSnapshotReceipt = {};
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('button', { name: 'Выполнить сверку', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Сверка могла сохраниться');
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: 'Уйти без проверки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.logouts).toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { fixturePrivateKeyCount: () => number }).fixturePrivateKeyCount()),
  ).toBe(0);
});

test('logout cancellation preserves a rename draft and explicit discard still logs out', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название' }).click();
  await page.getByRole('textbox', { name: 'Новое название' }).fill('Unsubmitted draft');
  await openAccountMenu(page);
  const logout = page.getByRole('button', { name: 'Выйти', exact: true });
  await logout.click();
  await expect(page.getByRole('alertdialog')).toContainText('Введённые данные будут потеряны');
  await page.getByRole('button', { name: 'Продолжить заполнение', exact: true }).click();
  await expect(logout).toBeFocused();
  expect(state.logouts).toBe(0);
  if (test.info().project.name === 'mobile') await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Новое название' })).toHaveValue('Unsubmitted draft');
  await openAccountMenu(page);
  await logout.click();
  await page.getByRole('button', { name: 'Не сохранять', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  expect(state.logouts).toBe(1);
});

test('missing issue page is distinct from an empty status and returns with the same filter', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'Mobile feed does not use a desktop page number');
  const state = await mockApi(page, 'OPERATOR');
  state.resolved = true;
  await page.goto('/tests/command-outcome.html?screen=issues');
  await expect(page.getByRole('heading', { name: 'Страница не найдена', exact: true })).toBeVisible();
  await expect(page.getByText('Проблем в выбранном состоянии нет.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'К первой странице', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Реестр разборов обмена' })).toBeVisible();
  expect(new URLSearchParams(state.issueReads.at(-1)).get('status')).toBe('RESOLVED');
  expect(new URLSearchParams(state.issueReads.at(-1)).get('page')).toBe('0');
  state.emptyIssues = true;
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проблем в выбранном состоянии нет.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'К первой странице', exact: true })).toHaveCount(0);
});

test('login shares the full-width brand and theme header and preserves entered credentials through theme changes', async ({
  page,
}) => {
  const state = await mockApi(page);
  state.signedIn = false;
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Обмен с внешней системой', exact: true })).toBeVisible();
  await expect(header.locator('.ui-icon-mark')).toBeVisible();
  await expect(header.getByRole('combobox', { name: 'Цветовая тема', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Основная навигация', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toHaveCount(0);
  expect(
    await header.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      width: element.getBoundingClientRect().width,
    })),
  ).toEqual({ left: 0, width: await page.evaluate(() => document.documentElement.clientWidth) });
  await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
  await page.getByLabel('Пароль *', { exact: true }).fill('fixture-password');
  await selectChoice(page, 'Цветовая тема', 'Светлая');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('textbox', { name: 'Логин', exact: true })).toHaveValue('fixture');
  await expect(page.getByLabel('Пароль *', { exact: true })).toHaveValue('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(header.getByRole('navigation', { name: 'Основная навигация', exact: true })).toBeVisible();
  expect(state.logins).toBe(1);
});

test('login acknowledgement followed by session failure recovers with GET only', async ({ page }) => {
  const state = await mockApi(page);
  state.signedIn = false;
  await page.goto('/tests/command-outcome.html');
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Логин', exact: true }).fill('fixture');
  await page.getByLabel('Пароль *', { exact: true }).fill('fixture-password');
  state.failSession = true;
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText('Неверный логин');
  state.failSession = false;
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Original task', exact: true })).toBeVisible();
  expect(state.logins).toBe(1);
});

test('general feed decision validates Unicode and submits no fabricated reconciliation', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.generalIssue = true;
  await page.goto('/tests/command-outcome.html?screen=issue');
  const reason = page.getByRole('textbox', { name: 'Причина решения', exact: true });
  const submit = page.getByRole('button', { name: 'Закрыть общую проблему', exact: true });
  await reason.fill('\u0085');
  await expect(submit).toBeDisabled();
  await reason.fill('x'.repeat(501));
  await expect(submit).toBeDisabled();
  await reason.fill('😀'.repeat(501));
  await expect(reason).toHaveValue('😀'.repeat(500));
  await reason.fill('😀'.repeat(500));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Решение сохранено.' })).toBeVisible();
  state.failRead = false;
  await page.getByRole('button', { name: 'Повторить обновление' }).click();
  await expect(page.getByRole('heading', { name: 'Разбор завершён', exact: true })).toBeVisible();
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].body).toEqual({
    expectedIssueRevision: 1,
    action: 'ACKNOWLEDGE_FEED_ISSUE',
    reason: '😀'.repeat(500),
  });
  await expect(page.getByRole('link', { name: 'Сверка, на которой основано решение' })).toHaveCount(0);
});

test('general issue draft allows logout without submitting a decision', async ({ page }) => {
  const state = await mockApi(page, 'OPERATOR');
  state.generalIssue = true;
  await page.goto('/tests/command-outcome.html?screen=issue');
  await page.getByRole('textbox', { name: 'Причина решения', exact: true }).fill('Несохранённая причина');
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Вход в систему', exact: true })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
  expect(state.logouts).toBe(1);
});

test('title field accepts the full Unicode boundary and rejects a neighboring excess', async ({ page }) => {
  await mockApi(page);
  await page.goto('/tests/command-outcome.html');
  await page.getByRole('button', { name: 'Изменить название', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Новое название', exact: true });
  for (const value of ['😀'.repeat(160), '\uFEFF', 'X\uFEFF']) {
    await input.fill(value);
    expect(await input.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(true);
  }
  for (const value of ['x'.repeat(161), '\u0085']) {
    await input.fill(value);
    expect(await input.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  }
});
