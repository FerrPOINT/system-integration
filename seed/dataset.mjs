import { catalog, generalIssues, id, SEED_VERSION } from './catalog.mjs';

/** Persisted demonstration snapshots, not a second implementation of exchange rules. */
export function dataset(users, anchor) {
  if (!['initiator.one', 'initiator.two', 'operator'].every((name) => users[name]))
    throw new Error('Demo users are required');
  const epoch = Date.parse(anchor);
  if (!Number.isFinite(epoch)) throw new Error('A valid seed anchor is required');
  const rows = Object.fromEntries(
    [
      'tasks',
      'task_history',
      'delivery_attempts',
      'delivery_queue',
      'reconciliations',
      'exchange_issues',
      'operations',
      'result_events',
      'faults',
    ].map((table) => [table, []]),
  );
  const examples = [];
  for (const item of catalog()) {
    const { index, scenario, reference, quantity, taskId, operationId } = item;
    const operator = users.operator;
    const owner = users[item.owner];
    // Curated examples are recent; the wider register covers three months.
    const age = index < 1000 ? 1 + ((index * 31) % 90) : (index - 1000) % 14;
    const start = epoch - age * 86400000 + (1 + (index % 10)) * 3600000 + (index % 59) * 60000;
    const time = (seconds) => new Date(start + seconds * 1000).toISOString();
    let tick = 0;
    let event = 0;
    let reconciliation = 0;
    const request = { reference, quantity };
    const pending = [
      'waiting',
      'unavailable',
      'retry',
      'protocol',
      'difference',
      'stopped',
      'assigned',
      'stale',
      'uncertain',
    ].includes(scenario);
    const rejected = scenario === 'rejected';
    const running = scenario === 'running';
    const paused = ['unavailable', 'retry', 'protocol'].includes(scenario);
    const missing = ['unavailable', 'retry', 'stopped', 'missing'].includes(scenario);
    const foreign = scenario === 'protocol';
    const completedSecond = scenario === 'retried' ? 95 : 8;
    const result = (status, version = 2, input = request) => ({
      operationId,
      request: input,
      version,
      status,
      ...(version === 2 ? { completedAt: time(completedSecond) } : {}),
      ...(status === 'REJECTED' ? { rejectionCode: 'QUANTITY_LIMIT_EXCEEDED' } : {}),
    });
    const actual = result(
      rejected ? 'REJECTED' : 'SUCCEEDED',
      2,
      foreign ? { reference: `REQ-${650001 + index}`, quantity } : request,
    );
    const conflicting = result('REJECTED');
    const accepted = pending ? null : running ? result('RUNNING', 1) : result(rejected ? 'REJECTED' : 'SUCCEEDED');
    const task = {
      id: taskId,
      owner_id: owner,
      operation_id: operationId,
      title: item.title,
      title_revision: 1,
      request_reference: reference,
      request_quantity: quantity,
      delivery_status: paused ? 'NEEDS_REVIEW' : scenario === 'stopped' ? 'STOPPED' : 'ACKNOWLEDGED',
      business_status: pending ? 'PENDING' : running ? 'RUNNING' : rejected ? 'REJECTED' : 'SUCCEEDED',
      created_at: time(0),
      exchange_version: 4,
      accepted_result: accepted,
    };
    const local = (delivery = task.delivery_status, value = accepted) => ({
      request,
      deliveryStatus: delivery,
      businessStatus: value?.status ?? 'PENDING',
      resultVersion: value?.version ?? null,
      result:
        value?.version === 2
          ? { status: value.status, completedAt: value.completedAt, rejectionCode: value.rejectionCode }
          : null,
    });
    const external = missing
      ? null
      : {
          operationId,
          request: actual.request,
          acceptedAt: time(scenario === 'retried' ? 90 : 2),
          executions: 1,
          result: actual,
        };
    const history = (type, summary, details = {}, actor = null, observed = null) => {
      if (type === 'RESULT_APPLIED' && details.resultVersion === 2) tick = Math.max(tick, completedSecond);
      rows.task_history.push({
        id: id(`history/${index}/${event++}`),
        task_id: taskId,
        operation_id: operationId,
        occurred_at: time((tick += 3)),
        actor: actor ? 'USER' : 'SYSTEM',
        actor_user_id: actor,
        event_type: type,
        summary,
        details,
        observed_result: observed,
        observation_fingerprint: null,
      });
    };
    history('CREATED', 'Заявка принята и поставлена в очередь обмена', {}, owner);
    const attempts = paused || ['stopped', 'retried'].includes(scenario) ? 5 : 1;
    for (let number = 1; number <= attempts; number++) {
      const attemptId = id(`attempt/${index}/${number}`);
      rows.delivery_attempts.push({
        id: attemptId,
        operation_id: operationId,
        number,
        step: number === 1 ? 'PUT' : 'GET',
        started_at: time(tick + 1),
        finished_at: time(tick + 2),
        outcome: foreign ? 'PROTOCOL_ERROR' : attempts > 1 ? 'TEMPORARY_FAILURE' : 'ACKNOWLEDGED',
      });
      history('DELIVERY_ATTEMPT', `Попытка ${number}: ${number === 1 ? 'PUT' : 'GET'}`, { attemptId });
    }
    if (paused || ['stopped', 'retried'].includes(scenario))
      history('DELIVERY_UNCERTAIN', 'Автоматическая серия завершена; требуется решение оператора');
    else history('DELIVERY_ACKNOWLEDGED', 'Исполнитель подтвердил получение операции');
    if (accepted && !['applied', 'retried'].includes(scenario)) {
      history(
        'RESULT_APPLIED',
        accepted.version === 1
          ? 'Принят промежуточный результат: RUNNING'
          : `Принят внешний результат: ${accepted.status}`,
        { resultVersion: accepted.version },
      );
    }
    if (!missing) {
      rows.operations.push({
        id: operationId,
        reference: actual.request.reference,
        quantity,
        accepted_at: external.acceptedAt,
        executions: 1,
        result: actual,
        completed_at: actual.completedAt,
      });
      // Archived completed imports do not republish a historical feed into the live cursor.
      for (const [value, copy] of index < 1000
        ? []
        : [
            [result('RUNNING', 1, actual.request), 0],
            [actual, 0],
            ...(scenario === 'duplicate' ? [[actual, 1]] : []),
          ]) {
        rows.result_events.push({
          operation_id: operationId,
          version: value.version,
          copy_number: copy,
          payload: value,
          publish_after: null,
          created_at: time(Math.max(30, completedSecond) + copy),
        });
      }
      // Held notifications are explicit. Releasing this reference uses the normal fault API.
      if (index >= 1000)
        rows.faults.push({
          reference: actual.request.reference,
          mode: 'DROP_RESPONSE_AFTER_EXECUTION',
          bound_operation_id: operationId,
        });
    } else if (scenario === 'unavailable')
      rows.faults.push({ reference, mode: 'UNAVAILABLE', bound_operation_id: null });

    const issueScenarios = [
      'unavailable',
      'retry',
      'protocol',
      'difference',
      'conflict',
      'applied',
      'stopped',
      'retried',
      'missing',
      'stale',
      'assigned',
      'uncertain',
    ];
    let issue = null;
    if (issueScenarios.includes(scenario)) {
      const kind = ['unavailable', 'retry', 'stopped', 'retried'].includes(scenario)
        ? 'DELIVERY_DELAYED'
        : scenario === 'protocol'
          ? 'PROTOCOL_ERROR'
          : scenario === 'conflict'
            ? 'RESULT_CONFLICT'
            : scenario === 'uncertain'
              ? 'DELIVERY_UNCERTAIN'
              : 'RECONCILIATION_DIFFERENCE';
      const summaries = {
        DELIVERY_DELAYED: 'Серия доставки исчерпана; ожидается проверка связи и разрешение оператора',
        PROTOCOL_ERROR: 'ID операции занят запросом с другим номером заявки',
        RESULT_CONFLICT: 'Получен противоречащий ранее принятому окончательный результат',
        DELIVERY_UNCERTAIN: 'Ответ исполнителя потерян; получение операции проверено отдельным запросом',
        RECONCILIATION_DIFFERENCE: 'Сверка обнаружила расхождение локального и внешнего состояния',
      };
      const resolved = ['applied', 'stopped', 'retried', 'uncertain'].includes(scenario);
      issue = {
        id: id(`issue/${index}`),
        task_id: taskId,
        operation_id: operationId,
        scope: operationId,
        fingerprint: id(`fingerprint/${index}`),
        issue_revision: 3,
        kind,
        status: resolved ? 'RESOLVED' : 'OPEN',
        opened_at: time(tick + 1),
        summary: summaries[kind],
        evidence: {
          reason: summaries[kind],
          local: local(
            ['applied', 'stopped', 'retried'].includes(scenario) ? 'NEEDS_REVIEW' : task.delivery_status,
            ['applied', 'retried'].includes(scenario) ? null : accepted,
          ),
          received: scenario === 'conflict' ? conflicting : null,
          cursor: null,
        },
        assigned_to: ['assigned', 'applied', 'stopped', 'retried'].includes(scenario) ? operator : null,
        latest_reconciliation_id: null,
        resolution: null,
      };
      if (['retried', 'uncertain'].includes(scenario)) issue.kind = 'DELIVERY_UNCERTAIN';
      history('ISSUE_OPENED', summaries[kind], { issueId: issue.id });
      if (issue.assigned_to)
        history(
          'RESPONSIBILITY_CHANGED',
          'Оператор взял разбор на себя',
          { issueId: issue.id, assignedTo: operator },
          operator,
        );
      if (scenario === 'conflict')
        history(
          'RESULT_IGNORED',
          'Конфликтующий результат сохранён для разбора',
          { issueId: issue.id, resultVersion: 2 },
          null,
          conflicting,
        );
    }

    function reconcile(
      outcome,
      availability,
      before = local(),
      beforeExternal = external,
      version = task.exchange_version,
    ) {
      const reconciliationId = id(`reconciliation/${index}/${reconciliation++}`);
      const checked = time(tick + 1);
      const snapshot = {
        reconciliationId,
        taskId,
        operationId,
        checkedAt: checked,
        checkedBy: operator,
        outcome,
        local: before,
        externalAvailability: availability,
        external: beforeExternal,
        issueId: issue?.id ?? null,
      };
      rows.reconciliations.push({
        id: reconciliationId,
        task_id: taskId,
        exchange_version: version,
        checked_at: checked,
        checked_by: operator,
        snapshot,
      });
      if (issue) issue.latest_reconciliation_id = reconciliationId;
      history(
        'RECONCILED',
        `Сверка ${outcome === 'MATCH' ? 'подтвердила совпадение' : outcome === 'UNAVAILABLE' ? 'не выполнена: исполнитель недоступен' : 'обнаружила расхождение'}`,
        { reconciliationId, ...(issue ? { issueId: issue.id } : {}) },
        operator,
      );
      return reconciliationId;
    }
    if (issue && scenario !== 'uncertain') {
      const before = ['applied', 'retried', 'stopped'].includes(scenario) ? local('NEEDS_REVIEW', null) : local();
      const outcome =
        scenario === 'unavailable'
          ? 'UNAVAILABLE'
          : ['retry', 'stopped', 'retried', 'conflict'].includes(scenario)
            ? 'MATCH'
            : 'DIFFERENCE';
      reconcile(
        outcome,
        scenario === 'unavailable'
          ? 'UNAVAILABLE'
          : ['retry', 'stopped', 'retried', 'missing'].includes(scenario)
            ? 'NOT_FOUND'
            : 'PRESENT',
        before,
        ['retried', 'stopped'].includes(scenario) ? null : external,
        ['applied', 'retried', 'stopped', 'stale'].includes(scenario)
          ? task.exchange_version - 1
          : task.exchange_version,
      );
    }
    if (['matched', 'long'].includes(scenario)) {
      const count = scenario === 'long' ? 120 : 1;
      for (let n = 0; n < count; n++) reconcile('MATCH', 'PRESENT');
    }
    if (scenario === 'stale') {
      history(
        'RESULT_IGNORED',
        'После сохранённой сверки получено новое наблюдение; основание решения устарело',
        { resultVersion: 1 },
        null,
        result('RUNNING', 1),
      );
    }
    if (scenario === 'late')
      history(
        'RESULT_IGNORED',
        'Запоздалый промежуточный снимок не изменил результат',
        { resultVersion: 1 },
        null,
        result('RUNNING', 1),
      );
    if (scenario === 'retried') {
      history(
        'RETRY_QUEUED',
        'Новая серия разрешена: канал восстановлен, отсутствие операции проверено',
        { issueId: issue.id, reconciliationId: issue.latest_reconciliation_id },
        operator,
      );
      for (const [number, step, outcome] of [
        [6, 'GET', 'NOT_FOUND'],
        [7, 'PUT', 'ACKNOWLEDGED'],
      ]) {
        const attemptId = id(`attempt/${index}/${number}`);
        rows.delivery_attempts.push({
          id: attemptId,
          operation_id: operationId,
          number,
          step,
          started_at: time(tick + 1),
          finished_at: time(tick + 2),
          outcome,
        });
        history('DELIVERY_ATTEMPT', `Попытка ${number}: ${step}`, { attemptId });
      }
      history('DELIVERY_ACKNOWLEDGED', 'Повторная доставка подтверждена; ID операции сохранён');
      history('RESULT_APPLIED', 'Принят внешний результат: SUCCEEDED', { resultVersion: 2 });
    }
    if (['applied', 'stopped'].includes(scenario)) {
      const action = scenario === 'applied' ? 'APPLY_EXTERNAL_RESULT' : 'ACKNOWLEDGE_DIFFERENCE';
      const reason =
        scenario === 'applied'
          ? 'Проверены номер заявки, объём и единственное исполнение. Принимаю фактический результат комплектации.'
          : 'Отправка отменена по согласованию со складом: заявка заменена новым заказом. Продолжение доставки не требуется.';
      issue.resolution = {
        issueId: issue.id,
        reconciliationId: issue.latest_reconciliation_id,
        action,
        reason,
        decidedBy: operator,
        decidedAt: time(tick + 2),
      };
      if (scenario === 'applied')
        history('RESULT_APPLIED', 'Внешний результат принят оператором после сверки', { resultVersion: 2 }, operator);
      history(
        'ISSUE_RESOLVED',
        `Решение оператора: ${reason}`,
        { issueId: issue.id, reconciliationId: issue.latest_reconciliation_id },
        operator,
      );
    } else if (issue?.status === 'RESOLVED')
      history('ISSUE_RESOLVED', 'Получение операции подтверждено; временная проблема закрыта', { issueId: issue.id });
    if (index % 11 === 0) {
      task.title += ' · уточнено';
      task.title_revision++;
      history('RENAMED', 'Уточнено назначение заявки после согласования с получателем', {}, owner);
    }
    if (paused)
      rows.delivery_queue.push({
        operation_id: operationId,
        next_step: 'GET',
        due_at: 'infinity',
        attempts,
        automatic_attempts: attempts,
        claim_id: null,
        claimed_until: null,
      });
    if (issue) rows.exchange_issues.push(issue);
    rows.tasks.push(task);
    if (index >= 1000)
      examples.push({
        ...item,
        title: task.title,
        issueId: issue?.id ?? null,
        reconciliationId:
          issue?.latest_reconciliation_id ?? rows.reconciliations.findLast((row) => row.task_id === taskId)?.id ?? null,
      });
  }
  for (const { index, issueId, resolved } of generalIssues) {
    const time = new Date(epoch - (index % 9) * 86400000 + 3600000).toISOString();
    rows.exchange_issues.push({
      id: issueId,
      task_id: null,
      operation_id: null,
      scope: 'feed',
      fingerprint: id(`feed-fingerprint/${index}`),
      issue_revision: resolved ? 2 : 1,
      kind: 'PROTOCOL_ERROR',
      status: resolved ? 'RESOLVED' : 'OPEN',
      opened_at: time,
      summary: [
        'Неверный формат страницы ленты результатов',
        'В сообщении отсутствует идентификатор операции',
        'Версия внешнего результата не поддерживается',
      ][index % 3],
      evidence: {
        reason: 'Исторический пример диагностики входящей ленты; служебные данные не содержат паролей или ключей',
        cursor: null,
        local: null,
        received: null,
      },
      assigned_to: null,
      latest_reconciliation_id: null,
      resolution: resolved
        ? {
            issueId,
            reconciliationId: null,
            action: 'ACKNOWLEDGE_FEED_ISSUE',
            reason:
              'Формат сообщения согласован с исполнителем, источник исправлен; дальнейшее наблюдение ведётся по журналу обмена.',
            decidedBy: users.operator,
            decidedAt: time,
          }
        : null,
    });
  }
  return { version: SEED_VERSION, anchor, rows, examples };
}
