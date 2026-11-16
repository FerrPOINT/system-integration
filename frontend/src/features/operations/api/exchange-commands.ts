import { useMutation } from '@tanstack/react-query';
import {
  reconcileTask,
  resolveExchangeIssue,
  retryExchange,
  takeExchangeIssue,
} from '../../../../build/generated/openapi/client';
import type { ResolveIssueRequest, RetryRequest, TakeIssueRequest } from '../../../../build/generated/openapi/client';
import { ApiError, data, ProtocolError } from '../../../shared/api/http';
import { useState } from 'react';
import { useSessionCommand } from '../../../shared/api/csrf';
import { useCommandKey } from '../../../shared/lib/forms/use-command-key';

export type DecisionCommand = ResolveIssueRequest | (RetryRequest & { action: 'RETRY' });

class UnknownReconciliationOutcome extends Error {
  constructor(cause: unknown) {
    super('Результат сверки неизвестен', { cause });
  }
}

export function useReconcileTask(taskId: string | undefined) {
  const key = useCommandKey();
  const send = useSessionCommand();
  const [unresolved, setUnresolved] = useState(false);
  const command = useMutation({
    mutationFn: () => {
      if (!taskId) throw new Error('Для сверки необходимо задание');
      const commandKey = key.forInput({ taskId });
      return send(async (headers) => {
        try {
          const receipt = await data(reconcileTask(taskId, { ...headers, 'Idempotency-Key': commandKey }));
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (
            !receipt ||
            typeof receipt.reconciliationId !== 'string' ||
            !uuid.test(receipt.reconciliationId) ||
            typeof receipt.taskId !== 'string' ||
            receipt.taskId.toLowerCase() !== taskId.toLowerCase() ||
            (receipt.issueId !== undefined && (typeof receipt.issueId !== 'string' || !uuid.test(receipt.issueId)))
          )
            throw new ProtocolError(200);
          return receipt;
        } catch (error) {
          if (error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status)) throw error;
          throw new UnknownReconciliationOutcome(error);
        }
      });
    },
    onError: (error) => {
      if (error instanceof UnknownReconciliationOutcome) setUnresolved(true);
    },
    onSuccess: () => {
      key.reset();
      setUnresolved(false);
    },
  });
  return { command, unresolved };
}

export function useTakeIssue(issueId: string) {
  const key = useCommandKey();
  const send = useSessionCommand();
  return useMutation({
    mutationFn: (input: TakeIssueRequest) => {
      const commandKey = key.forInput({ issueId, input });
      return send((headers) => data(takeExchangeIssue(issueId, input, { ...headers, 'Idempotency-Key': commandKey })));
    },
    onSuccess: () => key.reset(),
  });
}

export function useDecisionCommand(issueId: string) {
  const key = useCommandKey();
  const send = useSessionCommand();
  const command = useMutation({
    mutationFn: (input: DecisionCommand) => {
      const commandKey = key.forInput({ issueId, input });
      return send(async (csrfHeaders) => {
        const headers = { ...csrfHeaders, 'Idempotency-Key': commandKey };
        if (input.action === 'RETRY') {
          const { action: _action, ...body } = input;
          return data(retryExchange(issueId, body, headers));
        }
        return data(resolveExchangeIssue(issueId, input, headers));
      });
    },
    onSuccess: () => key.reset(),
  });
  return {
    command,
    resetCommand() {
      key.reset();
      command.reset();
    },
  };
}
