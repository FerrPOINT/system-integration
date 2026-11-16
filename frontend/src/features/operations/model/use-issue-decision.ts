import { useState } from 'react';
import { validReason } from '../../../shared/lib/form-rules';
import type { Issue } from '../../../../build/generated/openapi/client';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useDecisionCommand } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';
import { decisionActions, decisionBasis, isDecisionStale, type DecisionAction, type DecisionBasis } from './decision';

/** A draft captures its original decision basis; refetch never silently rebases it. */
export function useIssueDecision(issue: Issue, otherCommand: { pending: boolean; unresolved: boolean }) {
  const [action, setAction] = useState<DecisionAction | ''>('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState<DecisionBasis | null>(null);
  const { command, resetCommand } = useDecisionCommand(issue.issueId);
  const update = useExchangeRefresh();
  const dirty = Boolean(action || reason);
  const busy = command.isPending || otherCommand.pending;
  const guard = useFormNavigationGuard({ dirty: dirty || otherCommand.unresolved, pending: busy });
  const actions = decisionActions(issue);
  const stale = isDecisionStale(basis, issue) || Boolean(action && !actions.includes(action));
  const clearDraft = () => {
    resetCommand();
    setAction('');
    setReason('');
    setBasis(null);
  };
  const refresh = () => update.mutate({ issueId: issue.issueId, taskId: issue.taskId }, { onSuccess: clearDraft });
  function captureBasis() {
    guard.protect();
    setBasis((current) => current ?? decisionBasis(issue));
  }
  const input =
    !stale &&
    !busy &&
    !otherCommand.unresolved &&
    !command.isSuccess &&
    validReason(reason) &&
    action &&
    actions.includes(action) &&
    basis &&
    (action === 'ACKNOWLEDGE_FEED_ISSUE' || basis.latestReconciliationId)
      ? {
          expectedIssueRevision: basis.issueRevision,
          ...(basis.latestReconciliationId ? { reconciliationId: basis.latestReconciliationId } : {}),
          action,
          reason,
        }
      : null;
  return {
    action,
    reason,
    basis,
    dirty,
    busy,
    stale,
    actions,
    command,
    update,
    guard,
    refresh,
    visible:
      issue.status === 'OPEN' || dirty || busy || otherCommand.unresolved || (command.isSuccess && update.isError),
    canSubmit: input !== null,
    changeAction(value: DecisionAction) {
      captureBasis();
      setAction(value);
    },
    changeReason(value: string) {
      captureBasis();
      setReason(value);
    },
    close: () => guard.requestClose(clearDraft),
    rebase() {
      if (issue.status !== 'OPEN' || (!issue.latestReconciliationId && issue.taskId)) return;
      setBasis(decisionBasis(issue));
      if (action && !actions.includes(action)) setAction('');
    },
    submit() {
      if (!input) return;
      command.mutate(input, {
        onSuccess: () => {
          guard.release();
          refresh();
        },
      });
    },
  };
}

export type IssueDecisionModel = ReturnType<typeof useIssueDecision>;
