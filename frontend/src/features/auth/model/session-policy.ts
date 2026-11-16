import type { QueryClient } from '@tanstack/react-query';
import type { GetSession200 } from '../../../../build/generated/openapi/client';
import { ApiError } from '../../../shared/api/http.ts';
import { clearFeedPositions } from '../../../shared/lib/collections/feed-position-storage.ts';

export const sessionKey = ['session'] as const;

const scopes = new WeakMap<QueryClient, { generation: number; commands: WeakMap<object, number> }>();
function sessionScope(client: QueryClient) {
  let scope = scopes.get(client);
  if (!scope) {
    scope = { generation: 0, commands: new WeakMap() };
    scopes.set(client, scope);
  }
  return scope;
}

export function startSessionCommand(client: QueryClient, command: object) {
  const scope = sessionScope(client);
  scope.commands.set(command, scope.generation);
}

export function sessionGeneration(client: QueryClient) {
  return sessionScope(client).generation;
}

function clearPrivateCache(client: QueryClient) {
  const owned = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== sessionKey[0];
  const cancelled = client.cancelQueries({ predicate: owned });
  // Detach the old cache synchronously; cancellation may settle after a new login.
  client.removeQueries({ predicate: owned });
  client.getMutationCache().clear();
  return cancelled;
}

export async function clearSession(client: QueryClient, expectedGeneration = sessionGeneration(client)) {
  const scope = sessionScope(client);
  if (scope.generation !== expectedGeneration) return;
  const clearingGeneration = ++scope.generation;
  const cancelled = Promise.all([
    client.cancelQueries({ queryKey: sessionKey, exact: true }),
    clearPrivateCache(client),
  ]);
  clearFeedPositions();
  await cancelled;
  if (scope.generation !== clearingGeneration) return;
  // Preserve the observed session query so the auth gate sees the identity change.
  client.setQueryData(sessionKey, null);
}

export async function acceptSession(client: QueryClient, next: GetSession200) {
  const previous = client.getQueryData<GetSession200 | null>(sessionKey);
  if (previous?.userId !== next.userId || previous?.role !== next.role) {
    sessionScope(client).generation++;
    if (previous) clearFeedPositions();
    await clearPrivateCache(client);
  }
  return next;
}

export function expireSession(client: QueryClient, error: Error, command?: object) {
  const scope = sessionScope(client);
  // Removing a pending mutation from Query's cache does not stop its callbacks.
  if (command && scope.commands.get(command) !== scope.generation) return;
  if (error instanceof ApiError && error.status === 401) return clearSession(client);
}
