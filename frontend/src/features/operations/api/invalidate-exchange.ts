import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { taskKeys } from '../../tasks/api/task-keys.ts';
import { exchangeKeys } from './exchange-keys.ts';

export type ExchangeScope = { taskId: string; issueId?: string } | { issueId: string; taskId?: string };

export async function invalidateExchange(client: QueryClient, { taskId, issueId }: ExchangeScope) {
  if (!taskId && !issueId) throw new Error('Не указан обмен для обновления');
  const affected = [];
  if (issueId) affected.push(exchangeKeys.issue(issueId), exchangeKeys.issueLists);
  if (taskId) affected.push(taskKeys.task(taskId), taskKeys.taskLists);
  // Task detail prefixes include history; list prefixes cover every active filter.
  await Promise.all(affected.map(queryKey => client.invalidateQueries({ queryKey }, { throwOnError: true })));
}

/** The follow-up read has observable state independent of an accepted command. */
export function useExchangeRefresh() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (scope: ExchangeScope) => invalidateExchange(client, scope) });
}
