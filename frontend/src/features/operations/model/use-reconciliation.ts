import { useNavigate } from 'react-router-dom';
import type { Reconciliation } from '../../../../build/generated/openapi/client';
import { useReconcileTask } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';

/** The page owns navigation protection; this model owns the command and its read recovery. */
export function useReconciliation(taskId: string | undefined) {
  const navigate = useNavigate();
  const { command, unresolved } = useReconcileTask(taskId);
  const update = useExchangeRefresh();
  const refresh = (snapshot: Reconciliation) =>
    update.mutate(
      { taskId: snapshot.taskId, issueId: snapshot.issueId },
      {
        onSuccess: () => {
          command.reset();
          navigate('/tasks/' + snapshot.taskId + '/reconciliations/' + snapshot.reconciliationId);
        },
      },
    );
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
