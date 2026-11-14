import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTask, renameTask } from '../../../../build/generated/openapi/client';
import type { CreateTaskBody, RenameTaskBody } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { csrf } from '../../../shared/api/csrf';
import { useCommandKey } from '../../../shared/lib/forms/use-command-key';
import { taskKeys } from './task-keys';
import { taskOptions } from './task-queries';

export function useCreateTask() {
  const command = useCommandKey();
  return useMutation({
    mutationFn: async (input: CreateTaskBody) => data(createTask(input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) })),
    onSuccess: () => command.reset(),
  });
}

export function useRenameTask(taskId: string) {
  const command = useCommandKey();
  return useMutation({
    mutationFn: async (input: RenameTaskBody) => data(renameTask(taskId, input, { ...await csrf(), 'Idempotency-Key': command.forInput({ taskId, input }) })),
    onSuccess: () => command.reset(),
  });
}

export function useCreatedTaskRefresh() {
  const client = useQueryClient();
  return useMutation({ mutationFn: async (id: string) => {
    // A replayed receipt may be old. Read the authoritative task before opening it.
    await client.fetchQuery({ ...taskOptions(id), staleTime: 0 });
    await Promise.all([
      client.invalidateQueries({ queryKey: taskKeys.taskLists }, { throwOnError: true }),
      client.invalidateQueries({ queryKey: taskKeys.history(id) }, { throwOnError: true }),
    ]);
  } });
}

export function useTaskRefresh(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => Promise.all([
    client.invalidateQueries({ queryKey: taskKeys.task(id) }, { throwOnError: true }),
    client.invalidateQueries({ queryKey: taskKeys.taskLists }, { throwOnError: true }),
  ]) });
}
