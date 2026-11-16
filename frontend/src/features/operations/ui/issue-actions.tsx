import type { Issue } from '../../../../build/generated/openapi/client';
import { useRef } from 'react';
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
import { useReconciliation } from '../model/use-reconciliation';
import { DiscardDialog } from '../../../shared/ui/dialog';
import { DecisionForm } from './decision-form';
import { ReconcileControl } from './reconcile-button';

export function IssueActions({ issue }: { issue: Issue }) {
  const take = useTakeIssue(issue.issueId);
  const update = useExchangeRefresh();
  const reconciliation = useReconciliation(issue.taskId);
  const model = useIssueDecision(issue, {
    pending: take.isPending || reconciliation.command.isPending,
    unresolved: reconciliation.unresolved,
  });
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const reconcileTrigger = useRef<HTMLButtonElement>(null);
  const { guard } = model;
  const leavingUnresolved = guard.navigating && reconciliation.unresolved;
  const refreshOwnership = () =>
    update.mutate({ issueId: issue.issueId, taskId: issue.taskId }, { onSuccess: () => take.reset() });
  const conflict = take.error instanceof ApiError && take.error.status === 409;
  if (!model.visible) return null;
  return (
    <>
      <Card asChild>
        <section aria-labelledby="issue-actions-title">
          <CardContent className="base-page-stack">
            <CardTitle asChild>
              <h2 id="issue-actions-title">Действия оператора</h2>
            </CardTitle>
            <ActionGroup align="start">
              {issue.status === 'OPEN' && issue.allowedActions.includes('TAKE_OWNERSHIP') && (
                <Button
                  onClick={() => {
                    guard.protect();
                    conflict
                      ? refreshOwnership()
                      : take.mutate(take.variables ?? { expectedIssueRevision: issue.issueRevision }, {
                          onSuccess: refreshOwnership,
                        });
                  }}
                  disabled={model.busy || reconciliation.unresolved || take.isSuccess || update.isPending}
                >
                  {take.isPending
                    ? 'Сохраняем…'
                    : conflict
                      ? 'Обновить разбор'
                      : issue.assignedTo
                        ? 'Перенять разбор'
                        : 'Взять разбор'}
                </Button>
              )}
              {issue.taskId &&
                (issue.allowedActions.includes('RECONCILE') ||
                  reconciliation.command.isPending ||
                  reconciliation.unresolved ||
                  reconciliation.command.isSuccess) && (
                  <ReconcileControl
                    model={reconciliation}
                    trigger={reconcileTrigger}
                    disabled={take.isPending || model.command.isPending}
                    onStart={() => {
                      guard.protect();
                      reconciliation.run(() => {
                        if (!model.dirty) guard.release();
                      });
                    }}
                  />
                )}
            </ActionGroup>
            <ErrorMessage error={take.error} />
            <CommandRefresh
              message={take.isSuccess ? 'Ответственный назначен.' : 'Обновление разбора.'}
              error={update.error}
              pending={update.isPending}
              onRetry={refreshOwnership}
            />
            <DecisionForm issue={issue} model={model} reasonInput={reasonInput} />
            {issue.status === 'OPEN' && !model.actions.length && !model.dirty && (
              <Notice appearance="inline">
                {issue.taskId
                  ? 'Чтобы принять решение, выполните свежую сверку. Автоматические попытки приостановленной доставки не возобновляются без решения оператора.'
                  : 'Это общая проблема ленты событий. Проверьте диагностику и источник событий; действия над заданием недоступны.'}
              </Notice>
            )}
          </CardContent>
        </section>
      </Card>
      <DiscardDialog
        open={guard.open}
        returnFocusRef={leavingUnresolved ? reconcileTrigger : reasonInput}
        onCancel={guard.cancel}
        onDiscard={guard.discard}
        title={leavingUnresolved ? 'Уйти без проверки сверки?' : undefined}
        description={
          leavingUnresolved
            ? 'Сверка могла сохраниться. При уходе со страницы вы потеряете возможность безопасно повторить исходную команду. Несохранённый черновик также будет потерян.'
            : undefined
        }
        discardLabel={leavingUnresolved ? 'Уйти без проверки' : undefined}
        cancelLabel={leavingUnresolved ? 'Вернуться к проверке' : undefined}
      />
    </>
  );
}
