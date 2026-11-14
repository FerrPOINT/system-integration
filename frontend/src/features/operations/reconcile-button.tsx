import { ErrorMessage } from '../../app/error-message';
import { Button } from '../../ui/button';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { reconcileTask } from '../../../build/generated/openapi/client';
import { csrf, data } from '../../app/api';
import { useCommandKey } from '../../app/use-command-key';
import { useRefreshExchange } from './use-refresh-exchange';

export function ReconcileButton({ taskId }: { taskId: string }) {
  const navigate = useNavigate();
  const refresh = useRefreshExchange();
  const command = useCommandKey();
  const reconcile = useMutation({
    mutationFn: async () =>
      data(reconcileTask(taskId, { ...(await csrf()), 'Idempotency-Key': command.forInput(taskId) })),
    onSuccess: async (snapshot) => {
      await refresh();
      command.reset();
      navigate('/tasks/' + taskId + '/reconciliations/' + snapshot.reconciliationId);
    },
  });
  return (
    <div className="inline-action">
      <Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
        {reconcile.isPending ? 'Сверяем…' : 'Выполнить сверку'}
      </Button>
      <ErrorMessage error={reconcile.error} />
    </div>
  );
}
