import type { Issue } from '../../../../build/generated/openapi/client';
import { ApiError } from '../../../shared/api/http';
import { Button } from '../../../shared/ui/button';
import { ActionGroup } from '../../../shared/ui/action-group';
import { Card, CardContent, CardTitle } from '../../../shared/ui/card';
import { Notice } from '../../../shared/ui/notice';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { useTakeIssue } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';
import { useIssueDecision } from '../model/use-issue-decision';
import { DecisionForm } from './decision-form';
import { ReconcileButton } from './reconcile-button';

export function IssueActions({ issue }: { issue: Issue }) {
  const take = useTakeIssue(issue.issueId);
  const update = useExchangeRefresh();
  const model = useIssueDecision(issue);
  const refreshOwnership = () => update.mutate({ issueId: issue.issueId, taskId: issue.taskId }, { onSuccess: () => take.reset() });
  const conflict = take.error instanceof ApiError && take.error.status === 409;
  if (!model.visible) return null;
  return <Card asChild><section aria-labelledby="issue-actions-title"><CardContent className="base-page-stack">
    <CardTitle asChild><h2 id="issue-actions-title">Действия оператора</h2></CardTitle>
    {issue.status === 'OPEN' && <ActionGroup align="start">
      {issue.allowedActions.includes('TAKE_OWNERSHIP') && <Button onClick={() => conflict ? refreshOwnership() :
        take.mutate(take.variables ?? { expectedIssueRevision: issue.issueRevision }, { onSuccess: refreshOwnership })}
        disabled={take.isPending || take.isSuccess || update.isPending}>
        {take.isPending ? 'Сохраняем…' : conflict ? 'Обновить разбор' : issue.assignedTo ? 'Перенять разбор' : 'Взять разбор'}</Button>}
      {issue.taskId && issue.allowedActions.includes('RECONCILE') && <ReconcileButton taskId={issue.taskId} />}
    </ActionGroup>}
    <ErrorMessage error={take.error} />
    <CommandRefresh message={take.isSuccess ? 'Ответственный назначен.' : 'Обновление разбора.'} error={update.error} pending={update.isPending} onRetry={refreshOwnership} />
    <DecisionForm issue={issue} model={model} />
    {issue.status === 'OPEN' && !model.actions.length && !model.dirty && <Notice appearance="inline">{issue.taskId
      ? 'Чтобы принять решение, выполните свежую сверку. Автоматические попытки приостановленной доставки не возобновляются без решения оператора.'
      : 'Это общая проблема ленты событий. Проверьте диагностику и источник событий; действия над заданием недоступны.'}</Notice>}
  </CardContent></section></Card>;
}
