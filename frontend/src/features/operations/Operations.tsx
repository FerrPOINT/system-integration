import { ErrorMessage } from '../../app/error-message';
import { BackLink } from '../../ui/back-link';
import { Notice } from '../../ui/notice';
import { EmptyState } from '../../ui/empty-state';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getExchangeIssue, getTaskReconciliation, listExchangeIssues, reconcileTask, resolveExchangeIssue, retryExchange, takeExchangeIssue } from '../../../build/generated/openapi/client';
import type { Issue, IssueKind, IssueStatus, LocalSnapshot, OperationState, ResolutionAction, Result } from '../../../build/generated/openapi/client';
import { csrf, data, keys } from '../../app/api';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { useCommandKey } from '../../app/use-command-key';
import { Loading, Pagination, RefreshButton } from '../../ui/Feedback';
import { usePagination } from '../../app/use-pagination';

const kinds: Record<IssueKind, string> = {
  DELIVERY_UNCERTAIN: 'Доставка не подтверждена', DELIVERY_DELAYED: 'Лимит попыток исчерпан', PROTOCOL_ERROR: 'Ошибка протокола',
  RESULT_CONFLICT: 'Конфликт результата', RECONCILIATION_DIFFERENCE: 'Расхождение при сверке',
};
const outcomes = { MATCH: 'Состояния совпадают', DIFFERENCE: 'Обнаружено расхождение', UNAVAILABLE: 'Сверка недоступна' };
type DecisionAction = 'RETRY' | ResolutionAction;
const actionLabels: Record<DecisionAction, string> = {
  RETRY: 'Повторить обмен', APPLY_EXTERNAL_RESULT: 'Принять внешний результат', ACKNOWLEDGE_DIFFERENCE: 'Завершить разбор',
};

function useRefreshExchange() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: keys.issues }, { throwOnError: true }),
    client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true }),
  ]);
}

export function ReconcileButton({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshExchange();
  const command = useCommandKey();
  const reconcile = useMutation({
    mutationFn: async () => data(reconcileTask(taskId, { ...await csrf(), 'Idempotency-Key': command.forInput(taskId) })),
    onSuccess: async snapshot => {
      await refresh();
      command.reset();
      navigate('/tasks/' + taskId + '/reconciliations/' + snapshot.reconciliationId);
    },
  });
  return <div className="inline-action"><Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
    {reconcile.isPending ? 'Сверяем…' : 'Выполнить сверку'}</Button><ErrorMessage error={reconcile.error} /></div>;
}

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination();
  const status = search.get('status') || 'OPEN';
  const valid = validPage && ['OPEN', 'RESOLVED'].includes(status);
  const issues = useQuery({ queryKey: [...keys.issues, 'list', page, size, status], enabled: valid,
    queryFn: ({ signal }) => data(listExchangeIssues({ page, size, status: status as IssueStatus }, { signal })), placeholderData: keepPreviousData });
  return <>
    <div className="list-tools base-page-stack"><PageHeader title="Разбор обмена" context="Доставка, конфликты и решения операторов." actions={<RefreshButton pending={issues.isFetching} disabled={!valid} onClick={() => issues.refetch()} />} />
    <div className="readable"><FormField id="issue-status" label="Состояние разбора">{attrs => <Select {...attrs} value={status}
      onValueChange={status => setSearch({ status, size: String(size) })} options={[{ value: 'OPEN', label: 'Открытые' }, { value: 'RESOLVED', label: 'Завершённые' }]} />}</FormField></div></div>
    <section className="paged-list base-page-stack" aria-busy={issues.isFetching}><div className="paged-viewport" ref={viewportRef}>
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : issues.isPending ? <Loading /> : !issues.data ?
      <><ErrorMessage error={issues.error} /><Button onClick={() => issues.refetch()}>Повторить</Button></> : <>
      <ErrorMessage error={issues.error} />
      {issues.data.items.length === 0 ? <Card><EmptyState message="Проблем в выбранном состоянии нет." /></Card> :
        <ul className="issue-cards" data-page-items>{issues.data.items.slice(0, size).map(issue => <Card asChild key={issue.issueId} data-page-item><li><CardContent className="base-page-stack">
          <CardTitle asChild><h2><Link className="base-truncate" title={kinds[issue.kind]} to={'/issues/' + issue.issueId}>{kinds[issue.kind]}</Link></h2></CardTitle><p className="base-truncate" title={issue.summary}>{issue.summary}</p>
          <div className="issue-meta"><small>{timestamp(issue.openedAt)}</small><small>{issue.assignedTo ? 'Ответственный: ' + issue.assignedTo : 'Ответственный пока не назначен'}</small>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}</div>
        </CardContent></li></Card>)}</ul>}
    </>}
    </div><Pagination page={validPage ? page : 0} totalItems={issues.data?.totalItems ?? 0} totalPages={issues.data?.totalPages ?? 0} pending={issues.isFetching || !valid} onChange={changePage} />
    </section>
  </>;
}

export function IssueCard() {
  const { id = '' } = useParams();
  const issue = useQuery({ queryKey: keys.issue(id), queryFn: ({ signal }) => data(getExchangeIssue(id, { signal })) });
  if (issue.isPending) return <Loading />;
  if (!issue.data) return <><BackLink to="/issues">К разбору обмена</BackLink><ErrorMessage error={issue.error} />
    <Button onClick={() => issue.refetch()}>Повторить</Button></>;
  const item = issue.data;
  return <>
    <PageHeader className="issue-page-header" back={<BackLink to="/issues">К разбору обмена</BackLink>} title={kinds[item.kind]}
      actions={<RefreshButton pending={issue.isFetching} onClick={() => issue.refetch()} />} />
    <ErrorMessage error={issue.error} />
    <Card asChild><section aria-labelledby="issue-summary-title"><CardContent className="base-page-stack">
      <div className="issue-summary-heading"><CardTitle asChild><h2 id="issue-summary-title">{item.status === 'OPEN' ? 'Открытый разбор' : 'Разбор завершён'}</h2></CardTitle>
        <ActionGroup align="start">
          {item.taskId && <Link to={'/tasks/' + item.taskId}>Открыть задание и историю</Link>}
          {item.latestReconciliationId && item.taskId && <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.latestReconciliationId}>Открыть последнюю сверку</Link>}
        </ActionGroup>
      </div>
      <p>{item.summary}</p>
      <dl className="issue-facts">
        <div><dt>Открыт</dt><dd><time dateTime={item.openedAt}>{timestamp(item.openedAt)}</time></dd></div>
        <div><dt>Ответственный</dt><dd className={item.assignedTo ? 'technical' : undefined}>{item.assignedTo || 'Не назначен'}</dd></div>
        {item.operationId && <div className="issue-operation"><dt>ID операции</dt><dd className="technical">{item.operationId}</dd></div>}
        {item.nextAttemptAt && <div><dt>Следующая попытка</dt><dd><time dateTime={item.nextAttemptAt}>{timestamp(item.nextAttemptAt)}</time></dd></div>}
      </dl>
    </CardContent></section></Card>
    <div className="issue-workspace">
      {item.evidence && <Card asChild><section aria-labelledby="issue-evidence-title"><CardContent className="base-page-stack">
        <CardTitle asChild><h2 id="issue-evidence-title">Диагностика первого события</h2></CardTitle>
        <p className="muted">Сохранённые данные на момент ошибки. Текущее состояние проверяется отдельной сверкой.</p>
        {item.evidence.reason !== item.summary && <p>{item.evidence.reason}</p>}
        {item.evidence.cursor && <p>Позиция ленты: {item.evidence.cursor}</p>}
        {(item.evidence.local || item.evidence.received) && <div className="comparison-grid">
          {item.evidence.local && <Snapshot title="Локальный снимок при ошибке" value={item.evidence.local} />}
          {item.evidence.received && <ReceivedResult value={item.evidence.received} />}
        </div>}
      </CardContent></section></Card>}
      {item.status === 'OPEN' && <Card asChild><section aria-labelledby="issue-actions-title"><CardContent className="base-page-stack">
        <CardTitle asChild><h2 id="issue-actions-title">Действия оператора</h2></CardTitle>
        <IssueActions key={item.issueId} issue={item} />
      </CardContent></section></Card>}
      {item.resolution && <Card asChild><section aria-labelledby="issue-resolution-title"><CardContent className="base-page-stack">
        <CardTitle asChild><h2 id="issue-resolution-title">Решение</h2></CardTitle>
        <p>{actionLabels[item.resolution.action]}</p><p className="issue-decision-reason">{item.resolution.reason}</p>
        <dl className="issue-facts">
          <div><dt>Принято</dt><dd><time dateTime={item.resolution.decidedAt}>{timestamp(item.resolution.decidedAt)}</time></dd></div>
          <div><dt>Оператор</dt><dd className="technical">{item.resolution.decidedBy}</dd></div>
        </dl>
        {item.taskId && <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.resolution.reconciliationId}>Сверка, на которой основано решение</Link>}
      </CardContent></section></Card>}
    </div>
  </>;
}

function IssueActions({ issue }: { issue: Issue }) {
  const refresh = useRefreshExchange();
  const command = useCommandKey();
  const take = useMutation({
    mutationFn: async () => {
      const input = { expectedIssueRevision: issue.issueRevision };
      return data(takeExchangeIssue(issue.issueId, input, { ...await csrf(), 'Idempotency-Key': command.forInput({ id: issue.issueId, input }) }));
    },
    onSuccess: async () => { await refresh(); command.reset(); },
  });
  const decisions = issue.allowedActions.filter((action): action is DecisionAction => action === 'RETRY' || action === 'APPLY_EXTERNAL_RESULT' || action === 'ACKNOWLEDGE_DIFFERENCE');
  return <div className="base-page-stack">
    {issue.allowedActions.some(action => action === 'TAKE_OWNERSHIP' || action === 'RECONCILE') && <ActionGroup align="start">
      {issue.allowedActions.includes('TAKE_OWNERSHIP') && <Button onClick={() => take.mutate()} disabled={take.isPending}>
        {take.isPending ? 'Сохраняем…' : issue.assignedTo ? 'Перенять разбор' : 'Взять разбор'}</Button>}
      {issue.taskId && issue.allowedActions.includes('RECONCILE') && <ReconcileButton taskId={issue.taskId} />}
    </ActionGroup>}
    <ErrorMessage error={take.error} />
    {decisions.length > 0 ? <DecisionForm issue={issue} actions={decisions} /> :
      <Notice appearance="inline">{issue.taskId
        ? 'Чтобы принять решение, выполните свежую сверку. Автоматические попытки приостановленной доставки не возобновляются без решения оператора.'
        : 'Это общая проблема ленты событий. Проверьте диагностику и источник событий; действия над заданием недоступны.'}</Notice>}
  </div>;
}

function DecisionForm({ issue, actions }: { issue: Issue; actions: DecisionAction[] }) {
  const [action, setAction] = useState<DecisionAction | ''>('');
  const [reason, setReason] = useState('');
  const command = useCommandKey();
  const refresh = useRefreshExchange();
  const decide = useMutation({
    mutationFn: async () => {
      if (!action || !actions.includes(action)) throw new Error('Выберите доступное действие');
      const input = { expectedIssueRevision: issue.issueRevision, reason, reconciliationId: issue.latestReconciliationId };
      const headers = { ...await csrf(), 'Idempotency-Key': command.forInput({ id: issue.issueId, action, input }) };
      if (!issue.latestReconciliationId) throw new Error('Сначала выполните сверку');
      if (action === 'RETRY') return data(retryExchange(issue.issueId, input, headers));
      return data(resolveExchangeIssue(issue.issueId, { ...input, reconciliationId: issue.latestReconciliationId, action }, headers));
    },
    onSuccess: async () => { await refresh(); command.reset(); setReason(''); setAction(''); },
  });
  return <form aria-label="Решение оператора" aria-busy={decide.isPending} onSubmit={event => { event.preventDefault(); decide.mutate(); }}>
    <fieldset className="base-form-fieldset base-form" disabled={decide.isPending}>
    <FormField id="decision-action" label="Действие" required>{attrs => <Select {...attrs} value={action} placeholder="Выберите действие"
      onValueChange={value => setAction(value as DecisionAction)} options={actions.map(value => ({ value, label: actionLabels[value] }))} />}</FormField>
    {action === 'RETRY' && <Notice appearance="inline">Обмен продолжится с тем же ID операции и исходным запросом.</Notice>}
    {action === 'APPLY_EXTERNAL_RESULT' && <Notice appearance="inline">Результат последней сверки будет применён к заданию, разбор завершится.</Notice>}
    {action === 'ACKNOWLEDGE_DIFFERENCE' && <Notice>Локальный результат сохранится. Если доставка приостановлена, она будет окончательно остановлена.</Notice>}
    <FormField id="decision-reason" label="Причина решения" required hint="До 500 символов. Укажите, что проверили и почему выбрали это действие.">{attrs => <Textarea {...attrs} value={reason} maxLength={500} rows={3} onChange={event => setReason(event.target.value)} />}</FormField>
    <ErrorMessage error={decide.error} />
    <Button variant="default" disabled={decide.isPending || !reason.trim() || !action || !actions.includes(action)}>
      {decide.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Применить решение'}</Button>
    </fieldset>
  </form>;
}

export function ReconciliationCard() {
  const { taskId = '', reconciliationId = '' } = useParams();
  const snapshot = useQuery({ queryKey: keys.reconciliation(taskId, reconciliationId), staleTime: Infinity,
    queryFn: ({ signal }) => data(getTaskReconciliation(taskId, reconciliationId, { signal })) });
  if (snapshot.isPending) return <Loading />;
  if (!snapshot.data) return <><BackLink to={'/tasks/' + taskId}>К заданию</BackLink><ErrorMessage error={snapshot.error} />
    <Button onClick={() => snapshot.refetch()}>Повторить</Button></>;
  const item = snapshot.data;
  return <>
    <PageHeader back={<BackLink to={'/tasks/' + taskId}>К заданию</BackLink>}
      title="Сохранённая сверка" actions={<ReconcileButton taskId={taskId} />} />
    <ErrorMessage error={snapshot.error} />
    <Card asChild><section className="reconciliation-panel" data-outcome={item.outcome}><CardContent className="base-page-stack"><Notice tone={item.outcome === 'MATCH' ? 'success' : 'danger'} title={<CardTitle asChild><h2>{outcomes[item.outcome]}</h2></CardTitle>}>
      {timestamp(item.checkedAt)} · Оператор {item.checkedBy}</Notice>
      <p className="muted">Это сохранённые данные на момент проверки. Новая сверка создаст отдельную запись.</p>
      <div className="comparison-grid"><Snapshot title="В приложении" value={item.local} />
        {item.external ? <Snapshot title="У исполнителя" value={item.external} /> : <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h3>У исполнителя</h3></CardTitle>
          <p>{item.externalAvailability === 'NOT_FOUND' ? 'Операция с таким ID отсутствует' : 'Не удалось получить корректное состояние'}</p></CardContent></section></Card>}
      </div>
      {item.issueId && <Button asChild variant="default"><Link to={'/issues/' + item.issueId}>Перейти к разбору и решению</Link></Button>}
    </CardContent></section></Card>
  </>;
}

function Snapshot({ title, value }: { title: string; value: LocalSnapshot | OperationState }) {
  const external = 'executions' in value;
  const status = external ? value.result?.status || 'PENDING' : value.businessStatus;
  return <Card asChild><section className="snapshot"><CardContent className="base-page-stack"><CardTitle asChild><h3>{title}</h3></CardTitle><dl><dt>Заявка</dt><dd>{value.request.reference}</dd>
    <dt>Количество</dt><dd>{value.request.quantity}</dd>
    {!external && <><dt>Доставка</dt><dd>{deliveryLabels[value.deliveryStatus]}</dd></>}
    <dt>Исполнение</dt><dd>{businessLabels[status]}</dd>
    {external && <><dt>ID операции</dt><dd className="technical">{value.operationId}</dd><dt>Исполнений</dt><dd>{value.executions}</dd></>}
    {value.result?.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.result.completedAt)}</dd></>}
    {value.result?.rejectionCode && <><dt>Причина отказа</dt><dd>Количество превышает 100 единиц</dd></>}
  </dl></CardContent></section></Card>;
}

function ReceivedResult({ value }: { value: Result }) {
  return <Card asChild><section className="snapshot"><CardContent className="base-page-stack"><CardTitle asChild><h3>Входящий снимок</h3></CardTitle><dl><dt>ID операции</dt><dd className="technical">{value.operationId}</dd>
    <dt>Заявка</dt><dd>{value.request.reference}</dd><dt>Количество</dt><dd>{value.request.quantity}</dd><dt>Версия</dt><dd>{value.version}</dd>
    <dt>Исполнение</dt><dd>{businessLabels[value.status]}</dd>{value.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.completedAt)}</dd></>}
  </dl></CardContent></section></Card>;
}
