import { ErrorMessage } from '../../shared/ui/error-message';
import { Button } from '../../shared/ui/button';
import { CommandRefresh } from '../../shared/ui/command-refresh';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { reconcileTask } from '../../../build/generated/openapi/client';
import { data } from '../../shared/api/http';
import { csrf } from '../../shared/api/csrf';
import { useCommandKey } from '../../shared/lib/forms/use-command-key';
import { useRefreshExchange } from './use-refresh-exchange';

export function ReconcileButton({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshExchange();
  const command = useCommandKey();
  const update = useMutation({ mutationFn: refresh });
  const refreshSnapshot = (id: string) => update.mutate(undefined, {
    onSuccess: () => navigate('/tasks/' + taskId + '/reconciliations/' + id),
  });
  const reconcile = useMutation({
    mutationFn: async () => data(reconcileTask(taskId, { ...await csrf(), 'Idempotency-Key': command.forInput(taskId) })),
    onSuccess: snapshot => {
      command.reset();
      refreshSnapshot(snapshot.reconciliationId);
    },
  });
  return <div className="inline-action"><Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending || reconcile.isSuccess}>
    {reconcile.isPending ? 'Сверяем…' : 'Выполнить сверку'}</Button><ErrorMessage error={reconcile.error} />
    <CommandRefresh message="Сверка сохранена." error={update.error} pending={update.isPending}
      onRetry={() => reconcile.data && refreshSnapshot(reconcile.data.reconciliationId)} /></div>;
}
