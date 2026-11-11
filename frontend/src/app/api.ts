import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { getCsrfToken } from '../../build/generated/openapi/client';
import type { Problem } from '../../build/generated/openapi/client';

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem?: Problem) {
    const messages: Partial<Record<Problem['code'], string>> = {
      INVALID_CREDENTIALS: 'Неверный логин или пароль',
      SESSION_REQUIRED: 'Сессия завершена. Войдите снова',
      CSRF_INVALID: 'Защитный токен устарел. Повторите действие',
      ACCESS_DENIED: 'Недостаточно прав для этого действия',
    };
    super((problem && messages[problem.code]) || problem?.detail || problem?.title || 'Не удалось выполнить запрос');
  }
}

type Response = { status: number; data: unknown };
type Success<T> = Extract<T, { status: 200 | 201 | 204 }>;

export async function data<T extends Response>(request: Promise<T>): Promise<Success<T>['data']> {
  const response = await request;
  if (response.status < 200 || response.status >= 300) {
    throw new ApiError(response.status, response.data as Problem);
  }
  return response.data as Success<T>['data'];
}

export async function csrf() {
  return { 'X-CSRF-TOKEN': (await data(getCsrfToken())).token };
}

export const keys = {
  session: ['session'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  history: (id: string, page: number) => ['tasks', id, 'history', page] as const,
  issues: ['issues'] as const,
  issue: (id: string) => ['issues', id] as const,
  reconciliation: (task: string, id: string) => ['reconciliations', task, id] as const,
};

function expireSession(error: Error) {
  if (error instanceof ApiError && error.status === 401) {
    queryClient.clear();
    queryClient.setQueryData(keys.session, null);
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: expireSession }),
  mutationCache: new MutationCache({ onError: expireSession }),
  defaultOptions: {
    queries: { retry: false, staleTime: 3_000 },
    mutations: { retry: false },
  },
});
