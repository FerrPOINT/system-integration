import { useQueryClient } from '@tanstack/react-query';
import { exchangeKeys } from './api/exchange-keys';
import { taskKeys } from '../tasks/api/task-keys';

export function useRefreshExchange() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: exchangeKeys.issues }, { throwOnError: true }),
    client.invalidateQueries({ queryKey: taskKeys.tasks }, { throwOnError: true }),
  ]);
}
