import type { QueryClient } from '@tanstack/react-query';
import type { GetSession200 } from '../../../../build/generated/openapi/client';
import { ApiError } from '../../../shared/api/http';

export const sessionKey = ['session'] as const;

async function clearPrivateCache(client: QueryClient) {
  const owned = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== sessionKey[0];
  await client.cancelQueries({ predicate: owned });
  client.removeQueries({ predicate: owned });
  client.getMutationCache().clear();
}

export async function clearSession(client: QueryClient) {
  await client.cancelQueries({ queryKey: sessionKey, exact: true });
  await clearPrivateCache(client);
  // Preserve the observed session query so the auth gate sees the identity change.
  client.setQueryData(sessionKey, null);
}

export async function acceptSession(client: QueryClient, next: GetSession200) {
  const previous = client.getQueryData<GetSession200 | null>(sessionKey);
  if (previous?.userId !== next.userId || previous?.role !== next.role) await clearPrivateCache(client);
  return next;
}

export function expireSession(client: QueryClient, error: Error) {
  if (error instanceof ApiError && error.status === 401) return clearSession(client);
}
