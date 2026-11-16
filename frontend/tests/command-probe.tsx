import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { SessionRouteContext } from '../src/app/route-context';
import { useCreateTask, useRenameTask } from '../src/features/tasks/api/task-commands';
import { useDecisionCommand, useReconcileTask, useTakeIssue } from '../src/features/operations/api/exchange-commands';

const taskId = '00000000-0000-4000-8000-000000000001';
const snapshotId = '00000000-0000-4000-8000-000000000010';
const input = { title: 'Probe task', request: { reference: 'REQ-123456', quantity: 25 } };

/** Exercise public command hooks, including overlapping calls before pending is rendered. */
export function CommandProbe() {
  const { user } = useOutletContext<SessionRouteContext>();
  const create = useCreateTask();
  const rename = useRenameTask(taskId);
  const reconcile = useReconcileTask(taskId);
  const take = useTakeIssue(taskId);
  const { command: decision } = useDecisionCommand(taskId);
  const [receipts, setReceipts] = useState<unknown[]>([]);
  const run = (operation: () => Promise<unknown>) => {
    void operation().then(
      (receipt) => setReceipts((current) => [...current, receipt]),
      () => {},
    );
  };
  const basis = { expectedIssueRevision: 1, reconciliationId: snapshotId, reason: 'Verified fixture' };
  return (
    <section>
      <h1>Проверка команд</h1>
      <p>Текущий пользователь: {user.username}</p>
      <button onClick={() => run(() => create.command.mutateAsync(input))}>Создать</button>
      <button
        onClick={() => run(() => Promise.all([create.command.mutateAsync(input), create.command.mutateAsync(input)]))}
      >
        Дважды создать
      </button>
      <button onClick={() => run(() => rename.mutateAsync({ title: input.title, expectedTitleRevision: 1 }))}>
        Переименовать
      </button>
      <button onClick={() => run(() => reconcile.command.mutateAsync())}>Сверить</button>
      <button onClick={() => run(() => take.mutateAsync({ expectedIssueRevision: 1 }))}>Взять</button>
      <button onClick={() => run(() => decision.mutateAsync({ ...basis, action: 'ACKNOWLEDGE_DIFFERENCE' }))}>
        Решить
      </button>
      <button onClick={() => run(() => decision.mutateAsync({ ...basis, action: 'RETRY' }))}>Повторить обмен</button>
      <output aria-label="Квитанции">{JSON.stringify(receipts)}</output>
    </section>
  );
}
