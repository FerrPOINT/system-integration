import { useMutation } from '@tanstack/react-query';
import {
  reconcileTask,
  resolveExchangeIssue,
  retryExchange,
  takeExchangeIssue,
} from '../../../../build/generated/openapi/client';
import type { ResolveIssueRequest, RetryRequest, TakeIssueRequest } from '../../../../build/generated/openapi/client';
import { data } from '../../../shared/api/http';
import { csrf } from '../../../shared/api/csrf';
import { useCommandKey } from '../../../shared/lib/forms/use-command-key';

export type DecisionCommand = ResolveIssueRequest | (RetryRequest & { action: 'RETRY'; reconciliationId: string });

export function useReconcileTask(taskId: string) {
  const key = useCommandKey();
  return useMutation({
    mutationFn: async () =>
      data(reconcileTask(taskId, { ...(await csrf()), 'Idempotency-Key': key.forInput({ taskId }) })),
    onSuccess: () => key.reset(),
  });
}

export function useTakeIssue(issueId: string) {
  const key = useCommandKey();
  return useMutation({
    mutationFn: async (input: TakeIssueRequest) =>
      data(
        takeExchangeIssue(issueId, input, { ...(await csrf()), 'Idempotency-Key': key.forInput({ issueId, input }) }),
      ),
    onSuccess: () => key.reset(),
  });
}

export function useDecisionCommand(issueId: string) {
  const key = useCommandKey();
  const command = useMutation({
    mutationFn: async (input: DecisionCommand) => {
      const headers = { ...(await csrf()), 'Idempotency-Key': key.forInput({ issueId, input }) };
      if (input.action === 'RETRY') {
        const { action: _action, ...body } = input;
        return data(retryExchange(issueId, body, headers));
      }
      return data(resolveExchangeIssue(issueId, input, headers));
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
