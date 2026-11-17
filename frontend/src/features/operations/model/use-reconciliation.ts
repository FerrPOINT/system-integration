import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Reconciliation } from '../../../../build/generated/openapi/client';
import { useReconcileTask } from '../api/exchange-commands';
import { reconciliationOptions } from '../api/exchange-queries';
import { invalidateExchange } from '../api/invalidate-exchange';

/** The page owns navigation protection; this model owns the command and its read recovery. */
export function useReconciliation(taskId: string | undefined) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { command, unresolved } = useReconcileTask(taskId);
  const update = useMutation({
    mutationFn: async ({ taskId, issueId, reconciliationId }: Reconciliation) => {
      await Promise.all([
        invalidateExchange(client, { taskId, issueId }),
        client.fetchQuery(reconciliationOptions(taskId, reconciliationId)),
      ]);
    },
  });
  const refresh = (snapshot: Reconciliation) =>
    update.mutate(snapshot, {
      onSuccess: () => navigate('/tasks/' + snapshot.taskId + '/reconciliations/' + snapshot.reconciliationId),
    });
  return {
    command,
    unresolved,
    update,
    run(onAccepted: () => void) {
      command.mutate(undefined, {
        onSuccess: (snapshot) => {
          onAccepted();
          refresh(snapshot);
        },
      });
    },
    retryRefresh: () => command.data && refresh(command.data),
  };
}

export type ReconciliationModel = ReturnType<typeof useReconciliation>;
