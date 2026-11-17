import './operations.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Button } from '../../../shared/ui/button';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { Notice } from '../../../shared/ui/notice';
import { useRef, type RefObject } from 'react';
import { DiscardDialog } from '../../../shared/ui/dialog';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useReconciliation, type ReconciliationModel } from '../model/use-reconciliation';

export function ReconcileButton({ taskId }: { taskId: string }) {
  return <ReconcileAction key={taskId} taskId={taskId} />;
}

function ReconcileAction({ taskId }: { taskId: string }) {
  const model = useReconciliation(taskId);
  const trigger = useRef<HTMLButtonElement>(null);
  const guard = useFormNavigationGuard({ dirty: model.unresolved, pending: model.command.isPending });
  return (
    <>
      <ReconcileControl
        model={model}
        trigger={trigger}
        onStart={() => {
          guard.protect();
          model.run(guard.release);
        }}
      />
      <DiscardDialog
        open={guard.open}
        returnFocusRef={guard.exitFocusRef ?? trigger}
        onCancel={guard.cancel}
        onDiscard={guard.discard}
        title="Уйти без проверки сверки?"
        description="Сверка могла сохраниться. При уходе со страницы вы потеряете возможность безопасно повторить исходную команду."
        discardLabel="Уйти без проверки"
        cancelLabel="Вернуться к проверке"
      />
    </>
  );
}

/** IssueActions supplies its existing page guard instead of registering a second blocker. */
export function ReconcileControl({
  model,
  onStart,
  trigger,
  disabled,
}: {
  model: ReconciliationModel;
  onStart: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
}) {
  const { command: reconcile, unresolved, update } = model;
  if (reconcile.isSuccess)
    return (
      <CommandRefresh
        message="Сверка сохранена."
        error={update.error}
        pending={update.isPending}
        onRetry={model.retryRefresh}
      />
    );
  return (
    <div className="inline-action">
      <Button ref={trigger} onClick={onStart} disabled={disabled || reconcile.isPending}>
        {reconcile.isPending ? 'Сверяем…' : unresolved ? 'Проверить результат сверки' : 'Выполнить сверку'}
      </Button>
      {unresolved ? (
        <Notice role="alert" tone="warning">
          Сверка могла сохраниться. Проверьте результат повтором исходной команды.
        </Notice>
      ) : (
        <ErrorMessage error={reconcile.error} />
      )}
    </div>
  );
}
