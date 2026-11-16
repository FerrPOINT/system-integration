import type { QueryClient } from '@tanstack/react-query';

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

export const sessionGeneration = (client: QueryClient) => sessionScope(client).generation;
export const advanceSessionGeneration = (client: QueryClient) => ++sessionScope(client).generation;

export function startSessionCommand(client: QueryClient, command: object) {
  const scope = sessionScope(client);
  scope.commands.set(command, scope.generation);
}

export function isCurrentSessionCommand(client: QueryClient, command: object) {
  const scope = sessionScope(client);
  return scope.commands.get(command) === scope.generation;
}
