import type { IssueStatus } from '../../../../build/generated/openapi/client';

export const exchangeKeys = {
  issues: ['issues'] as const,
  issueLists: ['issues', 'list'] as const,
  issueList: (status: IssueStatus) => ['issues', 'list', status] as const,
  issue: (id: string) => ['issues', id] as const,
  reconciliation: (task: string, id: string) => ['reconciliations', task, id] as const,
};
