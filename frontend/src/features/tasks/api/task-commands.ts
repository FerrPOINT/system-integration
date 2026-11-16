import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createTask, renameTask } from '../../../../build/generated/openapi/client';
import type { CreateTaskBody, RenameTaskBody } from '../../../../build/generated/openapi/client';
import { ApiError, data, ProtocolError } from '../../../shared/api/http';
import { useSessionCommand } from '../../../shared/api/csrf';
import { useCommandKey } from '../../../shared/lib/forms/use-command-key';
import { taskKeys } from './task-keys';
import { taskOptions } from './task-queries';

class UnknownCreateOutcome extends Error {
  constructor(cause: unknown) {
    super('Результат отправки неизвестен', { cause });
  }
}

export function useCreateTask() {
  const key = useCommandKey();
  const send = useSessionCommand();
  // An uncertain earlier attempt stays uncertain even if a later CSRF/read fails.
  const [unresolved, setUnresolved] = useState(false);
  const command = useMutation({
    mutationFn: (input: CreateTaskBody) => {
      const commandKey = key.forInput(input);
      return send(async (headers) => {
        try {
          const receipt = await data(createTask(input, { ...headers, 'Idempotency-Key': commandKey }));
          if (
            typeof receipt?.taskId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.taskId)
          )
            throw new ProtocolError(201);
          return receipt;
        } catch (error) {
          // These are the create endpoint's explicit rejection responses in OpenAPI.
          if (error instanceof ApiError && [400, 401, 403, 409].includes(error.status)) throw error;
          throw new UnknownCreateOutcome(error);
        }
      });
    },
    onError: (error) => {
      if (error instanceof UnknownCreateOutcome) setUnresolved(true);
    },
    onSuccess: () => {
      key.reset();
      setUnresolved(false);
    },
  });
  return { command, unresolvedInput: unresolved ? command.variables : undefined };
}

export function useRenameTask(taskId: string) {
  const command = useCommandKey();
  const send = useSessionCommand();
  return useMutation({
    mutationFn: (input: RenameTaskBody) => {
      const commandKey = command.forInput({ taskId, input });
      return send((headers) => data(renameTask(taskId, input, { ...headers, 'Idempotency-Key': commandKey })));
    },
    onSuccess: () => command.reset(),
  });
}

export function useCreatedTaskRefresh() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // A replayed receipt may be old. Read the authoritative task before opening it.
      await client.fetchQuery({ ...taskOptions(id), staleTime: 0 });
      await Promise.all([
        client.invalidateQueries({ queryKey: taskKeys.taskLists }, { throwOnError: true }),
        client.invalidateQueries({ queryKey: taskKeys.history(id) }, { throwOnError: true }),
      ]);
    },
  });
}

export function useTaskRefresh(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: taskKeys.task(id) }, { throwOnError: true }),
        client.invalidateQueries({ queryKey: taskKeys.taskLists }, { throwOnError: true }),
      ]),
  });
}
