import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getExchangeIssue, getTaskReconciliation, listExchangeIssues, reconcileTask, resolveExchangeIssue, retryExchange, takeExchangeIssue } from '../../../build/generated/openapi/client';
import type { Issue, IssueKind, IssueStatus, LocalSnapshot, OperationState, ResolutionAction, Result } from '../../../build/generated/openapi/client';
import { csrf, data, keys } from '../../app/api';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { useCommandKey } from '../../app/use-command-key';
import { ErrorMessage, Loading, Pagination } from '../../ui/Feedback';

const kinds: Record<IssueKind, string> = {
  DELIVERY_UNCERTAIN: 'Доставка не подтверждена', DELIVERY_DELAYED: 'Длительная задержка', PROTOCOL_ERROR: 'Ошибка протокола',
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
  return <div className="inline-action"><button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
    {reconcile.isPending ? 'Сверяем…' : 'Выполнить сверку'}</button><ErrorMessage error={reconcile.error} /></div>;
}

export function IssueList() {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') || 0);
  const status = search.get('status') || 'OPEN';
  const valid = Number.isSafeInteger(page) && page >= 0 && ['OPEN', 'RESOLVED'].includes(status);
  const issues = useQuery({ queryKey: [...keys.issues, 'list', page, status], enabled: valid,
    queryFn: () => data(listExchangeIssues({ page, status: status as IssueStatus })) });
  return <>
    <div className="page-heading"><div><h1>Разбор обмена</h1><p className="muted">Доставка, конфликты и решения операторов.</p></div>
      <button onClick={() => issues.refetch()} disabled={issues.isFetching || !valid}>Обновить</button></div>
    <label className="readable">Состояние разбора<select value={status} onChange={event => setSearch({ status: event.target.value })}>
      <option value="OPEN">Открытые</option><option value="RESOLVED">Завершённые</option></select></label>
    {!valid ? <p role="alert">Некорректные параметры страницы.</p> : issues.isPending ? <Loading /> : !issues.data ?
      <><ErrorMessage error={issues.error} /><button onClick={() => issues.refetch()}>Повторить</button></> : <>
      <ErrorMessage error={issues.error} />
      {issues.data.items.length === 0 ? <p className="panel empty">Проблем в выбранном состоянии нет.</p> :
        <ul className="issue-cards">{issues.data.items.map(issue => <li className="panel" key={issue.issueId}>
          <h2><Link to={'/issues/' + issue.issueId}>{kinds[issue.kind]}</Link></h2><p>{issue.summary}</p>
          <small>{timestamp(issue.openedAt)}</small><small>{issue.assignedTo ? 'Ответственный: ' + issue.assignedTo : 'Ответственный пока не назначен'}</small>
          {issue.nextAttemptAt && <small>Следующая попытка: {timestamp(issue.nextAttemptAt)}</small>}
        </li>)}</ul>}
      <Pagination page={page} hasNext={issues.data.hasNext} pending={issues.isFetching}
        onChange={next => setSearch({ status, page: String(next) })} />
    </>}
  </>;
}

export function IssueCard() {
  const { id = '' } = useParams();
  const issue = useQuery({ queryKey: keys.issue(id), queryFn: () => data(getExchangeIssue(id)) });
  if (issue.isPending) return <Loading />;
  if (!issue.data) return <><Link to="/issues">← К разбору обмена</Link><ErrorMessage error={issue.error} />
    <button onClick={() => issue.refetch()}>Повторить</button></>;
  const item = issue.data;
  return <>
    <Link className="back-link" to="/issues">← К разбору обмена</Link>
    <div className="page-heading"><h1>{kinds[item.kind]}</h1><button onClick={() => issue.refetch()} disabled={issue.isFetching}>Обновить</button></div>
    <ErrorMessage error={issue.error} />
    <section className="panel"><h2>{item.status === 'OPEN' ? 'Открытый разбор' : 'Разбор завершён'}</h2><p>{item.summary}</p>
      <dl><dt>Открыт</dt><dd>{timestamp(item.openedAt)}</dd><dt>Ответственный</dt><dd className="technical">{item.assignedTo || 'Не назначен'}</dd>
        {item.operationId && <><dt>ID операции</dt><dd className="technical">{item.operationId}</dd></>}
        {item.nextAttemptAt && <><dt>Следующая попытка</dt><dd>{timestamp(item.nextAttemptAt)}</dd></>}
      </dl>
      {item.taskId && <Link to={'/tasks/' + item.taskId}>Открыть задание и историю</Link>}
      <IssueActions issue={item} />
    </section>
    {item.evidence && <section className="panel history"><h2>Диагностика первого события</h2><p>{item.evidence.reason}</p>
      {item.evidence.cursor && <p>Позиция ленты: {item.evidence.cursor}</p>}
      <div className="comparison-grid">
        {item.evidence.local && <Snapshot title="Локальный снимок при ошибке" value={item.evidence.local} />}
        {item.evidence.received && <ReceivedResult value={item.evidence.received} />}
      </div>
    </section>}
    {item.latestReconciliationId && item.taskId && <p className="history"><Link className="button" to={'/tasks/' + item.taskId + '/reconciliations/' + item.latestReconciliationId}>
      Открыть последнюю сверку</Link></p>}
    {item.resolution && <section className="panel history"><h2>Решение</h2><p>{actionLabels[item.resolution.action]}</p><p>{item.resolution.reason}</p>
      <small>{timestamp(item.resolution.decidedAt)} · Оператор {item.resolution.decidedBy}</small>
      {item.taskId && <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.resolution.reconciliationId}>Сверка, на которой основано решение</Link>}
    </section>}
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
  if (issue.status !== 'OPEN') return null;
  const decisions = issue.allowedActions.filter((action): action is DecisionAction => action === 'RETRY' || action === 'APPLY_EXTERNAL_RESULT' || action === 'ACKNOWLEDGE_DIFFERENCE');
  return <div className="history">
    <div className="actions">
      {issue.allowedActions.includes('TAKE_OWNERSHIP') && <button onClick={() => take.mutate()} disabled={take.isPending}>
        {take.isPending ? 'Сохраняем…' : issue.assignedTo ? 'Перенять разбор' : 'Взять разбор'}</button>}
      {issue.taskId && issue.allowedActions.includes('RECONCILE') && <ReconcileButton taskId={issue.taskId} />}
    </div>
    <ErrorMessage error={take.error} />
    {decisions.length > 0 ? <DecisionForm issue={issue} actions={decisions} /> :
      issue.taskId && <p className="muted history">Чтобы принять решение, выполните свежую сверку. Сетевые попытки продолжаются по расписанию, если отправка не приостановлена.</p>}
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
      if (action === 'RETRY') return data(retryExchange(issue.issueId, input, headers));
      if (!issue.latestReconciliationId) throw new Error('Сначала выполните сверку');
      return data(resolveExchangeIssue(issue.issueId, { ...input, reconciliationId: issue.latestReconciliationId, action }, headers));
    },
    onSuccess: async () => { await refresh(); command.reset(); setReason(''); setAction(''); },
  });
  return <form className="edit-form" onSubmit={event => { event.preventDefault(); decide.mutate(); }}>
    <label>Действие<select value={action} required onChange={event => setAction(event.target.value as DecisionAction | '')}>
      <option value="">Выберите действие</option>{actions.map(value => <option key={value} value={value}>{actionLabels[value]}</option>)}</select></label>
    {action === 'ACKNOWLEDGE_DIFFERENCE' && <p className="message">Локальный результат сохранится. Приостановленная из-за ошибки протокола отправка будет окончательно остановлена.</p>}
    {issue.latestReconciliationId && issue.taskId && <Link to={'/tasks/' + issue.taskId + '/reconciliations/' + issue.latestReconciliationId}>Сверка для этого решения</Link>}
    <label>Причина решения<textarea value={reason} required maxLength={500} rows={3} onChange={event => setReason(event.target.value)} /></label>
    <ErrorMessage error={decide.error} />
    <button className="primary" disabled={decide.isPending || !reason.trim() || !action || !actions.includes(action)}>
      {decide.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Выполнить'}</button>
  </form>;
}

export function ReconciliationCard() {
  const { taskId = '', reconciliationId = '' } = useParams();
  const snapshot = useQuery({ queryKey: keys.reconciliation(taskId, reconciliationId), staleTime: Infinity,
    queryFn: () => data(getTaskReconciliation(taskId, reconciliationId)) });
  if (snapshot.isPending) return <Loading />;
  if (!snapshot.data) return <><Link to={'/tasks/' + taskId}>← К заданию</Link><ErrorMessage error={snapshot.error} />
    <button onClick={() => snapshot.refetch()}>Повторить</button></>;
  const item = snapshot.data;
  return <>
    <Link className="back-link" to={'/tasks/' + taskId}>← К заданию</Link>
    <div className="page-heading"><h1>Сохранённая сверка</h1><ReconcileButton taskId={taskId} /></div>
    <ErrorMessage error={snapshot.error} />
    <section className="panel"><h2>{outcomes[item.outcome]}</h2><p>{timestamp(item.checkedAt)} · Оператор {item.checkedBy}</p>
      <p className="muted">Это сохранённые данные на момент проверки. Новая сверка создаст отдельную запись.</p>
      <div className="comparison-grid"><Snapshot title="В приложении" value={item.local} />
        {item.external ? <Snapshot title="У исполнителя" value={item.external} /> : <section><h3>У исполнителя</h3>
          <p>{item.externalAvailability === 'NOT_FOUND' ? 'Операция с таким ID отсутствует' : 'Не удалось получить корректное состояние'}</p></section>}
      </div>
      {item.issueId && <Link className="button primary" to={'/issues/' + item.issueId}>Перейти к разбору и решению</Link>}
    </section>
  </>;
}

function Snapshot({ title, value }: { title: string; value: LocalSnapshot | OperationState }) {
  const external = 'executions' in value;
  const status = external ? value.result?.status || 'PENDING' : value.businessStatus;
  return <section className="snapshot"><h3>{title}</h3><dl><dt>Заявка</dt><dd>{value.request.reference}</dd>
    <dt>Количество</dt><dd>{value.request.quantity}</dd>
    {!external && <><dt>Доставка</dt><dd>{deliveryLabels[value.deliveryStatus]}</dd></>}
    <dt>Исполнение</dt><dd>{businessLabels[status]}</dd>
    {external && <><dt>ID операции</dt><dd className="technical">{value.operationId}</dd><dt>Исполнений</dt><dd>{value.executions}</dd></>}
    {value.result?.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.result.completedAt)}</dd></>}
    {value.result?.rejectionCode && <><dt>Причина отказа</dt><dd>Количество превышает 100 единиц</dd></>}
  </dl></section>;
}

function ReceivedResult({ value }: { value: Result }) {
  return <section className="snapshot"><h3>Входящий снимок</h3><dl><dt>ID операции</dt><dd className="technical">{value.operationId}</dd>
    <dt>Заявка</dt><dd>{value.request.reference}</dd><dt>Количество</dt><dd>{value.request.quantity}</dd><dt>Версия</dt><dd>{value.version}</dd>
    <dt>Исполнение</dt><dd>{businessLabels[value.status]}</dd>{value.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.completedAt)}</dd></>}
  </dl></section>;
}
