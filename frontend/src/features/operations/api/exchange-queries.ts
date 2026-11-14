import { queryOptions } from '@tanstack/react-query';
import { getExchangeIssue, getTaskReconciliation, listExchangeIssues } from '../../../../build/generated/openapi/client';
import type { ListExchangeIssuesParams } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { exchangeKeys } from './exchange-keys';

export const issueOptions = (id: string) => queryOptions({
  queryKey: exchangeKeys.issue(id), queryFn: ({ signal }) => data(getExchangeIssue(id, { signal })),
});

export const reconciliationOptions = (taskId: string, reconciliationId: string) => queryOptions({
  queryKey: exchangeKeys.reconciliation(taskId, reconciliationId), staleTime: Infinity,
  queryFn: ({ signal }) => data(getTaskReconciliation(taskId, reconciliationId, { signal })),
});

export const readIssuePage = (params: ListExchangeIssuesParams, signal: AbortSignal) => data(listExchangeIssues(params, { signal }));
