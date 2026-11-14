import { ErrorMessage } from '../../../shared/ui/error-message';
import { ActionGroup } from '../../../shared/ui/action-group';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { useRef, useState } from 'react';
import type { Task } from '../../../../build/generated/openapi/client';
import { ApiError } from '../../../shared/api/http';
import { DiscardDialog } from '../../../shared/ui/dialog';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useRenameTask, useTaskRefresh } from '../api/task-commands';

export function RenameForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const [revision] = useState(task.titleRevision);
  const [dirty, setDirty] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const [initialTitle] = useState(task.title);
  const refresh = useTaskRefresh(task.taskId);
  const refreshTask = () => refresh.mutate(undefined, { onSuccess: onClose });
  const rename = useRenameTask(task.taskId);
  const conflict = rename.error instanceof ApiError && rename.error.status === 409;
  const guard = useFormNavigationGuard({ dirty, pending: rename.isPending });
  return (
    <>
      <form
        className="base-form edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!rename.isPending && !rename.isSuccess)
            rename.mutate(
              { title: String(new FormData(event.currentTarget).get('title')), expectedTitleRevision: revision },
              {
                onSuccess: () => {
                  guard.release();
                  refreshTask();
                },
              },
            );
        }}
      >
        <fieldset className="base-form-fieldset base-form" disabled={rename.isPending || rename.isSuccess}>
          <FormField id="field-title" label="Новое название" required>
            {(attrs) => (
              <Input
                {...attrs}
                ref={titleInput}
                name="title"
                maxLength={160}
                pattern=".*\S.*"
                defaultValue={initialTitle}
                autoFocus
                onChange={(event) => setDirty(event.target.value !== initialTitle)}
              />
            )}
          </FormField>
        </fieldset>
        <ErrorMessage error={rename.error} />
        <CommandRefresh
          message="Название сохранено."
          error={refresh.error}
          pending={refresh.isPending}
          onRetry={refreshTask}
        />
        <ActionGroup align="start">
          {!rename.isSuccess && (
            <Button variant="default" disabled={rename.isPending || conflict}>
              Сохранить
            </Button>
          )}
          <Button
            type="button"
            disabled={rename.isPending}
            onClick={() =>
              guard.requestClose(
                conflict
                  ? () => {
                      guard.release();
                      refreshTask();
                    }
                  : onClose,
              )
            }
          >
            {conflict ? 'Обновить карточку' : rename.isSuccess ? 'Закрыть' : 'Отмена'}
          </Button>
        </ActionGroup>
      </form>
      <DiscardDialog open={guard.open} returnFocusRef={titleInput} onCancel={guard.cancel} onDiscard={guard.discard} />
    </>
  );
}
