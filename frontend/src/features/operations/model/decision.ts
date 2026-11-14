import type { Issue, ResolutionAction } from '../../../../build/generated/openapi/client';

export type DecisionAction = 'RETRY' | ResolutionAction;
export type DecisionBasis = Pick<Issue, 'issueRevision' | 'latestReconciliationId'>;

export const actionLabels: Record<DecisionAction, string> = {
  RETRY: 'Повторить обмен', APPLY_EXTERNAL_RESULT: 'Принять внешний результат', ACKNOWLEDGE_DIFFERENCE: 'Завершить разбор',
};

export const decisionActions = (issue: Issue) => issue.allowedActions.filter((action): action is DecisionAction =>
  action === 'RETRY' || action === 'APPLY_EXTERNAL_RESULT' || action === 'ACKNOWLEDGE_DIFFERENCE');
export const decisionBasis = (issue: Issue): DecisionBasis => ({ issueRevision: issue.issueRevision, latestReconciliationId: issue.latestReconciliationId });
export const isDecisionStale = (basis: DecisionBasis | null, issue: Issue) => Boolean(basis &&
  (basis.issueRevision !== issue.issueRevision || basis.latestReconciliationId !== issue.latestReconciliationId || issue.status !== 'OPEN'));
