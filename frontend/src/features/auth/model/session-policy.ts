import type { QueryClient } from '@tanstack/react-query';
import type { GetSession200 } from '../../../../build/generated/openapi/client';
import { ApiError } from '../../../shared/api/http.ts';
import { clearFeedPositions } from '../../../shared/lib/collections/feed-position-storage.ts';
import {
  advanceSessionGeneration,
  isCurrentSessionCommand,
  sessionGeneration,
  sessionKey,
} from '../../../shared/api/session-scope.ts';

function clearPrivateCache(client: QueryClient) {
  const owned = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== sessionKey[0];
  const cancelled = client.cancelQueries({ predicate: owned });
  // Detach the old cache synchronously; cancellation may settle after a new login.
  client.removeQueries({ predicate: owned });
  client.getMutationCache().clear();
  return cancelled;
}

export async function clearSession(client: QueryClient, expectedGeneration = sessionGeneration(client)) {
  if (sessionGeneration(client) !== expectedGeneration) return;
  const clearingGeneration = advanceSessionGeneration(client);
  const cancelled = Promise.all([
    client.cancelQueries({ queryKey: sessionKey, exact: true }),
    clearPrivateCache(client),
  ]);
  clearFeedPositions();
  await cancelled;
  if (sessionGeneration(client) !== clearingGeneration) return;
  // Preserve the observed session query so the auth gate sees the identity change.
  client.setQueryData(sessionKey, null);
}

export async function acceptSession(client: QueryClient, next: GetSession200) {
  const previous = client.getQueryData<GetSession200 | null>(sessionKey);
  if (previous?.userId !== next.userId || previous?.role !== next.role) {
    advanceSessionGeneration(client);
    if (previous) clearFeedPositions();
    await clearPrivateCache(client);
  }
  return next;
}

export function expireSession(client: QueryClient, error: Error, command?: object) {
  // Removing a pending mutation from Query's cache does not stop its callbacks.
  if (command && !isCurrentSessionCommand(client, command)) return;
  if (error instanceof ApiError && error.status === 401) return clearSession(client);
}
