import { useState } from 'react';
import type { Issue } from '../../../../build/generated/openapi/client';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useDecisionCommand } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';
import { decisionActions, decisionBasis, isDecisionStale, type DecisionAction, type DecisionBasis } from './decision';

/** A draft captures its original decision basis; refetch never silently rebases it. */
export function useIssueDecision(issue: Issue) {
  const [action, setAction] = useState<DecisionAction | ''>('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState<DecisionBasis | null>(null);
  const { command, resetCommand } = useDecisionCommand(issue.issueId);
  const update = useExchangeRefresh();
  const dirty = Boolean(action || reason);
  const guard = useFormNavigationGuard({ dirty, pending: command.isPending });
  const actions = decisionActions(issue);
  const stale = isDecisionStale(basis, issue) || Boolean(action && !actions.includes(action));
  const clearDraft = () => { resetCommand(); setAction(''); setReason(''); setBasis(null); };
  const refresh = () => update.mutate({ issueId: issue.issueId, taskId: issue.taskId }, { onSuccess: clearDraft });
  function captureBasis() { guard.protect(); setBasis(current => current ?? decisionBasis(issue)); }
  return { action, reason, basis, dirty, stale, actions, command, update, guard, refresh,
    visible: issue.status === 'OPEN' || dirty || command.isPending || (command.isSuccess && update.isError),
    canSubmit: !stale && !command.isPending && !command.isSuccess && Boolean(reason.trim() && action && actions.includes(action) && basis?.latestReconciliationId),
    changeAction(value: DecisionAction) { captureBasis(); setAction(value); },
    changeReason(value: string) { captureBasis(); setReason(value); },
    close: () => guard.requestClose(clearDraft),
    rebase() {
      if (issue.status !== 'OPEN' || !issue.latestReconciliationId) return;
      setBasis(decisionBasis(issue));
      if (action && !actions.includes(action)) setAction('');
    },
    submit() {
      if (stale || command.isPending || command.isSuccess || !reason.trim() || !action || !actions.includes(action) || !basis?.latestReconciliationId) return;
      command.mutate({ expectedIssueRevision: basis.issueRevision, reconciliationId: basis.latestReconciliationId, action, reason },
        { onSuccess: () => { guard.release(); refresh(); } });
    },
  };
}

export type IssueDecisionModel = ReturnType<typeof useIssueDecision>;
