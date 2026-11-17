import { useState } from 'react';
import { validReason } from '../../../shared/lib/form-rules';
import type { Issue } from '../../../../build/generated/openapi/client';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useDecisionCommand } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';
import { decisionActions, decisionBasis, isDecisionStale, type DecisionAction, type DecisionBasis } from './decision';

type DecisionDraft = {
  action: DecisionAction | '';
  reason: string;
  basis: DecisionBasis;
};

/** A draft captures its original decision basis; refetch never silently rebases it. */
export function useIssueDecision(issue: Issue, otherCommand: { pending: boolean; unresolved: boolean }) {
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const actions = decisionActions(issue);
  const singleAction = actions.length === 1 ? actions[0] : '';
  const action = draft?.action ?? singleAction;
  const reason = draft?.reason ?? '';
  const basis = draft?.basis ?? null;
  const { command, resetCommand } = useDecisionCommand(issue.issueId);
  const update = useExchangeRefresh();
  const dirty = draft !== null;
  const busy = command.isPending || otherCommand.pending;
  const guard = useFormNavigationGuard({ dirty: otherCommand.unresolved, pending: busy });
  const stale = isDecisionStale(basis, issue) || Boolean(action && !actions.includes(action));
  const clearDraft = () => {
    resetCommand();
    setDraft(null);
  };
  const refresh = () => update.mutate({ issueId: issue.issueId, taskId: issue.taskId }, { onSuccess: clearDraft });
  function editDraft(nextAction: DecisionAction | '', nextReason: string) {
    const hasSelection = actions.length > 1 && nextAction && actions.includes(nextAction);
    if (!nextReason && !hasSelection) {
      clearDraft();
      return;
    }
    setDraft({ action: nextAction, reason: nextReason, basis: basis ?? decisionBasis(issue) });
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
    dirty,
    busy,
    stale,
    actions,
    command,
    update,
    guard,
    refresh,
    visible: issue.status === 'OPEN' || dirty || busy || otherCommand.unresolved || command.isSuccess,
    canSubmit: input !== null,
    changeAction: (value: DecisionAction) => editDraft(value, reason),
    changeReason: (value: string) => editDraft(action, value),
    rebase() {
      if (!draft || issue.status !== 'OPEN' || (!issue.latestReconciliationId && issue.taskId)) return;
      const nextAction = action && actions.includes(action) ? action : singleAction;
      setDraft(
        reason || nextAction !== singleAction ? { action: nextAction, reason, basis: decisionBasis(issue) } : null,
      );
    },
    submit() {
      if (!input) return;
      guard.protect();
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
