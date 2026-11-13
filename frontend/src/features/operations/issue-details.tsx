import { ErrorMessage } from '../../app/error-message';
import { BackLink } from '../../ui/back-link';
import { Notice } from '../../ui/notice';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getExchangeIssue, resolveExchangeIssue, retryExchange, takeExchangeIssue } from '../../../build/generated/openapi/client';
import type { Issue, ResolutionAction, Result } from '../../../build/generated/openapi/client';
import { csrf, data, keys } from '../../app/api';
import { businessLabels, timestamp } from '../../app/format';
import { useCommandKey } from '../../app/use-command-key';
import { Loading } from '../../ui/Feedback';
import { issueKindLabels } from './issue-labels';
import { useRefreshExchange } from './use-refresh-exchange';
import { ReconcileButton } from './reconcile-button';
import { Snapshot } from './exchange-snapshot';

type DecisionAction = 'RETRY' | ResolutionAction;
const actionLabels: Record<DecisionAction, string> = {
  RETRY: 'Повторить обмен', APPLY_EXTERNAL_RESULT: 'Принять внешний результат', ACKNOWLEDGE_DIFFERENCE: 'Завершить разбор',
};

export function IssueCard() {
  const { id = '' } = useParams();
  const issue = useQuery({ queryKey: keys.issue(id), queryFn: ({ signal }) => data(getExchangeIssue(id, { signal })) });
  if (issue.isPending) return <Loading />;
  if (!issue.data) return <><BackLink to="/issues">К разбору обмена</BackLink><ErrorMessage error={issue.error} />
    <Button onClick={() => issue.refetch()}>Повторить</Button></>;
  const item = issue.data;
  return <>
    <BackLink to="/issues">К разбору обмена</BackLink>
    <PageHeader title={issueKindLabels[item.kind]} actions={<Button onClick={() => issue.refetch()} disabled={issue.isFetching}>Обновить</Button>} />
    <ErrorMessage error={issue.error} />
    <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h2>{item.status === 'OPEN' ? 'Открытый разбор' : 'Разбор завершён'}</h2></CardTitle><p>{item.summary}</p>
      <dl><dt>Открыт</dt><dd>{timestamp(item.openedAt)}</dd><dt>Ответственный</dt><dd className="technical">{item.assignedTo || 'Не назначен'}</dd>
        {item.operationId && <><dt>ID операции</dt><dd className="technical">{item.operationId}</dd></>}
        {item.nextAttemptAt && <><dt>Следующая попытка</dt><dd>{timestamp(item.nextAttemptAt)}</dd></>}
      </dl>
      {item.taskId && <Link to={'/tasks/' + item.taskId}>Открыть задание и историю</Link>}
      <IssueActions issue={item} />
    </CardContent></section></Card>
    {item.evidence && <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h2>Диагностика первого события</h2></CardTitle><p>{item.evidence.reason}</p>
      {item.evidence.cursor && <p>Позиция ленты: {item.evidence.cursor}</p>}
      <div className="comparison-grid">
        {item.evidence.local && <Snapshot title="Локальный снимок при ошибке" value={item.evidence.local} />}
        {item.evidence.received && <ReceivedResult value={item.evidence.received} />}
      </div>
    </CardContent></section></Card>}
    {item.latestReconciliationId && item.taskId && <p><Button asChild><Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.latestReconciliationId}>
      Открыть последнюю сверку</Link></Button></p>}
    {item.resolution && <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h2>Решение</h2></CardTitle><p>{actionLabels[item.resolution.action]}</p><p>{item.resolution.reason}</p>
      <small>{timestamp(item.resolution.decidedAt)} · Оператор {item.resolution.decidedBy}</small>
      {item.taskId && <Link to={'/tasks/' + item.taskId + '/reconciliations/' + item.resolution.reconciliationId}>Сверка, на которой основано решение</Link>}
    </CardContent></section></Card>}
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
  return <div className="base-page-stack">
    <ActionGroup align="start">
      {issue.allowedActions.includes('TAKE_OWNERSHIP') && <Button onClick={() => take.mutate()} disabled={take.isPending}>
        {take.isPending ? 'Сохраняем…' : issue.assignedTo ? 'Перенять разбор' : 'Взять разбор'}</Button>}
      {issue.taskId && issue.allowedActions.includes('RECONCILE') && <ReconcileButton taskId={issue.taskId} />}
    </ActionGroup>
    <ErrorMessage error={take.error} />
    {decisions.length > 0 ? <DecisionForm issue={issue} actions={decisions} /> :
      issue.taskId && <p className="muted">Чтобы принять решение, выполните свежую сверку. Автоматические попытки приостановленной доставки не возобновляются без решения оператора.</p>}
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
  return <form className="base-form edit-form" onSubmit={event => { event.preventDefault(); decide.mutate(); }}>
    <FormField id="decision-action" label="Действие" required>{attrs => <Select {...attrs} value={action} placeholder="Выберите действие"
      onValueChange={value => setAction(value as DecisionAction)} options={actions.map(value => ({ value, label: actionLabels[value] }))} />}</FormField>
    {action === 'ACKNOWLEDGE_DIFFERENCE' && <Notice>Локальный результат сохранится. Приостановленная доставка будет окончательно остановлена.</Notice>}
    {issue.latestReconciliationId && issue.taskId && <Link to={'/tasks/' + issue.taskId + '/reconciliations/' + issue.latestReconciliationId}>Сверка для этого решения</Link>}
    <FormField id="decision-reason" label="Причина решения" required>{attrs => <Textarea {...attrs} value={reason} maxLength={500} rows={3} onChange={event => setReason(event.target.value)} />}</FormField>
    <ErrorMessage error={decide.error} />
    <Button variant="default" disabled={decide.isPending || !reason.trim() || !action || !actions.includes(action)}>
      {decide.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Выполнить'}</Button>
  </form>;
}

function ReceivedResult({ value }: { value: Result }) {
  return <Card asChild><section className="snapshot"><CardContent className="base-page-stack"><CardTitle asChild><h3>Входящий снимок</h3></CardTitle><dl><dt>ID операции</dt><dd className="technical">{value.operationId}</dd>
    <dt>Заявка</dt><dd>{value.request.reference}</dd><dt>Количество</dt><dd>{value.request.quantity}</dd><dt>Версия</dt><dd>{value.version}</dd>
    <dt>Исполнение</dt><dd>{businessLabels[value.status]}</dd>{value.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.completedAt)}</dd></>}
  </dl></CardContent></section></Card>;
}
