import type { ListTasksParams } from '../../../../build/generated/openapi/client';

/** Public keys used by exchange invalidation; no task UI or command dependencies. */
export const taskKeys = {
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  history: (id: string) => ['tasks', id, 'history'] as const,
  taskList: ({ businessStatus, createdFrom, createdTo }: Pick<ListTasksParams, 'businessStatus' | 'createdFrom' | 'createdTo'>) =>
    ['tasks', 'list', { businessStatus, createdFrom, createdTo }] as const,
};
