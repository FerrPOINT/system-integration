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
import { CommandRefresh } from '../../ui/command-refresh';
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getExchangeIssue, resolveExchangeIssue, retryExchange, takeExchangeIssue } from '../../../build/generated/openapi/client';
import type { Issue, ResolutionAction, Result } from '../../../build/generated/openapi/client';
import { keys } from '../../app/api';
import { data } from '../../shared/api/http';
import { csrf } from '../../shared/api/csrf';
import { businessLabels, timestamp } from '../../app/format';
import { useCommandKey } from '../../app/use-command-key';
import { Loading, RefreshButton } from '../../ui/Feedback';
import { issueKindLabels as kinds } from './issue-labels';
import { useRefreshExchange } from './use-refresh-exchange';
import { ReconcileButton } from './reconcile-button';
import { Snapshot } from './exchange-snapshot';
import { useListReturn } from '../../app/use-list-return';
import { DiscardDialog } from '../../ui/dialog';
import { useFormNavigationGuard } from '../../shared/lib/forms/use-form-navigation-guard';

type DecisionAction = 'RETRY' | ResolutionAction;

const actionLabels: Record<DecisionAction, string> = {
  RETRY: 'Повторить обмен', APPLY_EXTERNAL_RESULT: 'Принять внешний результат', ACKNOWLEDGE_DIFFERENCE: 'Завершить разбор',
};

export function IssueCard() {
  const returnTo = useListReturn('/issues');
  const { id = '' } = useParams();
  const issue = useQuery({ queryKey: keys.issue(id), queryFn: ({ signal }) => data(getExchangeIssue(id, { signal })) });
  if (issue.isPending) return <Loading />;
  if (!issue.data) return <><BackLink to={returnTo}>К разбору обмена</BackLink><ErrorMessage error={issue.error} />
    <Button onClick={() => issue.refetch()}>Повторить</Button></>;
  const item = issue.data;
  return <>
    <PageHeader className="detail-page-header" back={<BackLink to={returnTo}>К разбору обмена</BackLink>} title={kinds[item.kind]}
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
  const update = useMutation({ mutationFn: refresh });
  const command = useCommandKey();
  const take = useMutation({
    mutationFn: async () => {
      const input = { expectedIssueRevision: issue.issueRevision };
      return data(takeExchangeIssue(issue.issueId, input, { ...await csrf(), 'Idempotency-Key': command.forInput({ id: issue.issueId, input }) }));
    },
    onSuccess: () => { command.reset(); update.mutate(undefined, { onSuccess: () => take.reset() }); },
  });
  const decisions = issue.allowedActions.filter((action): action is DecisionAction => action === 'RETRY' || action === 'APPLY_EXTERNAL_RESULT' || action === 'ACKNOWLEDGE_DIFFERENCE');
  return <div className="base-page-stack">
    {issue.allowedActions.some(action => action === 'TAKE_OWNERSHIP' || action === 'RECONCILE') && <ActionGroup align="start">
      {issue.allowedActions.includes('TAKE_OWNERSHIP') && <Button onClick={() => take.mutate()} disabled={take.isPending || take.isSuccess}>
        {take.isPending ? 'Сохраняем…' : issue.assignedTo ? 'Перенять разбор' : 'Взять разбор'}</Button>}
      {issue.taskId && issue.allowedActions.includes('RECONCILE') && <ReconcileButton taskId={issue.taskId} />}
    </ActionGroup>}
    <ErrorMessage error={take.error} />
    <CommandRefresh message="Ответственный назначен." error={update.error} pending={update.isPending}
      onRetry={() => update.mutate(undefined, { onSuccess: () => take.reset() })} />
    {decisions.length > 0 ? <DecisionForm issue={issue} actions={decisions} /> :
      <Notice appearance="inline">{issue.taskId
        ? 'Чтобы принять решение, выполните свежую сверку. Автоматические попытки приостановленной доставки не возобновляются без решения оператора.'
        : 'Это общая проблема ленты событий. Проверьте диагностику и источник событий; действия над заданием недоступны.'}</Notice>}
  </div>;
}

function DecisionForm({ issue, actions }: { issue: Issue; actions: DecisionAction[] }) {
  const [action, setAction] = useState<DecisionAction | ''>('');
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const command = useCommandKey();
  const refresh = useRefreshExchange();
  const update = useMutation({ mutationFn: refresh });
  const refreshDecision = () => update.mutate(undefined, {
    onSuccess: () => { decide.reset(); setReason(''); setAction(''); },
  });
  const decide = useMutation({
    mutationFn: async () => {
      if (!action || !actions.includes(action)) throw new Error('Выберите доступное действие');
      const input = { expectedIssueRevision: issue.issueRevision, reason, reconciliationId: issue.latestReconciliationId };
      const headers = { ...await csrf(), 'Idempotency-Key': command.forInput({ id: issue.issueId, action, input }) };
      if (!issue.latestReconciliationId) throw new Error('Сначала выполните сверку');
      if (action === 'RETRY') return data(retryExchange(issue.issueId, input, headers));
      return data(resolveExchangeIssue(issue.issueId, { ...input, reconciliationId: issue.latestReconciliationId, action }, headers));
    },
    onSuccess: () => { command.reset(); guard.release(); refreshDecision(); },
  });
  const guard = useFormNavigationGuard({ dirty: Boolean(action || reason), pending: decide.isPending });
  return <><form aria-label="Решение оператора" aria-busy={decide.isPending} onSubmit={event => { event.preventDefault(); if (!decide.isPending && !decide.isSuccess) decide.mutate(); }}>
    <fieldset className="base-form-fieldset base-form" disabled={decide.isPending || decide.isSuccess}>
    <FormField id="decision-action" label="Действие" required>{attrs => <Select {...attrs} value={action} placeholder="Выберите действие"
      onValueChange={value => { guard.protect(); setAction(value as DecisionAction); }} options={actions.map(value => ({ value, label: actionLabels[value] }))} />}</FormField>
    {action === 'RETRY' && <Notice appearance="inline">Обмен продолжится с тем же ID операции и исходным запросом.</Notice>}
    {action === 'APPLY_EXTERNAL_RESULT' && <Notice appearance="inline">Результат последней сверки будет применён к заданию, разбор завершится.</Notice>}
    {action === 'ACKNOWLEDGE_DIFFERENCE' && <Notice>Локальный результат сохранится. Если доставка приостановлена, она будет окончательно остановлена.</Notice>}
    <FormField id="decision-reason" label="Причина решения" required hint="До 500 символов. Укажите, что проверили и почему выбрали это действие.">{attrs => <Textarea {...attrs} ref={reasonInput} value={reason} maxLength={500} rows={3} onChange={event => { guard.protect(); setReason(event.target.value); }} />}</FormField>
    <ErrorMessage error={decide.error} />
    <Button variant="default" disabled={decide.isPending || !reason.trim() || !action || !actions.includes(action)}>
      {decide.isPending ? 'Сохраняем решение…' : action ? actionLabels[action] : 'Применить решение'}</Button>
    </fieldset>
    <CommandRefresh message="Решение сохранено." error={update.error} pending={update.isPending} onRetry={refreshDecision} />
  </form><DiscardDialog open={guard.open} returnFocusRef={reasonInput} onCancel={guard.cancel} onDiscard={guard.discard} /></>;
}

function ReceivedResult({ value }: { value: Result }) {
  return <Card asChild><section className="snapshot"><CardContent className="base-page-stack"><CardTitle asChild><h3>Входящий снимок</h3></CardTitle><dl><dt>ID операции</dt><dd className="technical">{value.operationId}</dd>
    <dt>Заявка</dt><dd>{value.request.reference}</dd><dt>Количество</dt><dd>{value.request.quantity}</dd><dt>Версия</dt><dd>{value.version}</dd>
    <dt>Исполнение</dt><dd>{businessLabels[value.status]}</dd>{value.completedAt && <><dt>Завершено</dt><dd>{timestamp(value.completedAt)}</dd></>}
  </dl></CardContent></section></Card>;
}
