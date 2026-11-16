import './operations.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Button } from '../../../shared/ui/button';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { Notice } from '../../../shared/ui/notice';
import { useNavigate } from 'react-router-dom';
import type { Reconciliation } from '../../../../build/generated/openapi/client';
import { useReconcileTask } from '../api/exchange-commands';
import { useExchangeRefresh } from '../api/invalidate-exchange';

export function ReconcileButton({ taskId }: { taskId: string }) {
  return <ReconcileAction key={taskId} taskId={taskId} />;
}

function ReconcileAction({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const update = useExchangeRefresh();
  const { command: reconcile, unresolved } = useReconcileTask(taskId);
  const refreshSnapshot = (snapshot: Reconciliation) =>
    update.mutate(
      { taskId, issueId: snapshot.issueId },
      {
        onSuccess: () => {
          reconcile.reset();
          navigate('/tasks/' + taskId + '/reconciliations/' + snapshot.reconciliationId);
        },
      },
    );
  return (
    <div className="inline-action">
      <Button
        onClick={() => reconcile.mutate(undefined, { onSuccess: refreshSnapshot })}
        disabled={reconcile.isPending || reconcile.isSuccess}
      >
        {reconcile.isPending ? 'Сверяем…' : unresolved ? 'Проверить результат сверки' : 'Выполнить сверку'}
      </Button>
      {unresolved ? (
        <Notice role="alert" tone="warning">
          Сверка могла сохраниться. Проверьте результат повтором исходной команды.
        </Notice>
      ) : (
        <ErrorMessage error={reconcile.error} />
      )}
      <CommandRefresh
        message="Сверка сохранена."
        error={update.error}
        pending={update.isPending}
        onRetry={() => reconcile.data && refreshSnapshot(reconcile.data)}
      />
    </div>
  );
}
