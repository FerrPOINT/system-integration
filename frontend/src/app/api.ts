import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { getSession } from '../../build/generated/openapi/client';
import type { GetSession200, ListTasksParams, IssueStatus } from '../../build/generated/openapi/client';
import { ApiError, data } from '../shared/api/http';

export const keys = {
  session: ['session'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  history: (id: string) => ['tasks', id, 'history'] as const,
  taskList: ({ businessStatus, createdFrom, createdTo }: Pick<ListTasksParams, 'businessStatus' | 'createdFrom' | 'createdTo'>) => ['tasks', 'list', { businessStatus, createdFrom, createdTo }] as const,
  issueList: (status: IssueStatus) => ['issues', 'list', status] as const,
  collection: (base: readonly unknown[], feed: boolean, page: number, size: number) => [...base, feed ? 'feed' : 'page', feed ? 0 : page, size] as const,
  issues: ['issues'] as const,
  issue: (id: string) => ['issues', id] as const,
  reconciliation: (task: string, id: string) => ['reconciliations', task, id] as const,
};

async function clearUserCache() {
  const owned = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== keys.session[0];
  await queryClient.cancelQueries({ predicate: owned });
  queryClient.removeQueries({ predicate: owned });
  queryClient.getMutationCache().clear();
}

export async function clearSession() {
  await queryClient.cancelQueries({ queryKey: keys.session, exact: true });
  await clearUserCache();
  // Keep the observed session query so App remains subscribed to identity changes.
  queryClient.setQueryData(keys.session, null);
}

export async function readSession({ signal }: { signal: AbortSignal }) {
  const next = await data(getSession({ signal }));
  const previous = queryClient.getQueryData<GetSession200 | null>(keys.session);
  if (previous?.userId !== next.userId || previous?.role !== next.role) await clearUserCache();
  return next;
}

function expireSession(error: Error) {
  if (error instanceof ApiError && error.status === 401) void clearSession();
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: expireSession }),
  mutationCache: new MutationCache({ onError: expireSession }),
  defaultOptions: {
    queries: { retry: false, staleTime: 3_000 },
    mutations: { retry: false },
  },
});
