import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../../app/api';

export function useRefreshExchange() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: keys.issues }, { throwOnError: true }),
    client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true }),
  ]);
}
