import { titleInputProps, referenceInputProps, quantityInputProps } from '../../../shared/lib/form-rules';
import './tasks.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { FormField } from '../../../shared/ui/form-field';
import { Input } from '../../../shared/ui/input';
import { Button } from '../../../shared/ui/button';
import { CommandRefresh } from '../../../shared/ui/command-refresh';
import { Notice } from '../../../shared/ui/notice';
import { useRef, useState } from 'react';
import { Dialog, DiscardDialog } from '../../../shared/ui/dialog';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useFormNavigationGuard } from '../../../shared/lib/forms/use-form-navigation-guard';
import { useCreateTask, useCreatedTaskRefresh } from '../api/task-commands';
import type { TaskRouteContext } from './task-route-context';

export function NewTask() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { createTrigger: returnFocusRef } = useOutletContext<TaskRouteContext>();
  const titleInput = useRef<HTMLInputElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);
  const refresh = useCreatedTaskRefresh();
  const refreshCreated = (id: string) =>
    refresh.mutate(id, {
      // Per-call callbacks do not redirect after the user has left this component.
      onSuccess: () => navigate('/tasks/' + id),
    });
  const { command: create, unresolvedInput } = useCreateTask();
  const guard = useFormNavigationGuard({ dirty, pending: create.isPending });
  const submit = (form: FormData) => {
    if (create.isPending || create.isSuccess) return;
    const input = unresolvedInput ?? {
      title: String(form.get('title')),
      request: { reference: String(form.get('reference')), quantity: Number(form.get('quantity')) },
    };
    create.mutate(input, {
      onSuccess: (result) => {
        guard.release();
        refreshCreated(result.taskId);
      },
    });
  };
  const close = () => navigate({ pathname: '/tasks', search: search.toString() }, { replace: true });
  return (
    <>
      <Dialog
        open
        title="Новое задание"
        description="Задание сохранится сразу, отправка исполнителю продолжится в фоне."
        onClose={close}
        pending={create.isPending}
        returnFocusRef={returnFocusRef}
      >
        <form
          className="ui-dialog-form"
          onChange={(event) => {
            const form = new FormData(event.currentTarget);
            setDirty(Boolean(form.get('title') || form.get('reference') || form.get('quantity') !== '25'));
          }}
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          }}
        >
          <div className="ui-dialog-body ui-page-stack">
            <fieldset
              className="ui-form-fieldset ui-form"
              disabled={create.isPending || create.isSuccess || Boolean(unresolvedInput)}
              aria-label="Данные задания"
            >
              <FormField id="field-title" label="Название" required>
                {(attrs) => <Input {...attrs} ref={titleInput} name="title" {...titleInputProps} autoFocus />}
              </FormField>
              <div className="task-input-row">
                <FormField
                  id="field-reference"
                  label="Номер заявки"
                  required
                  hint="REQ- и шесть цифр. После создания изменить нельзя."
                >
                  {(attrs) => <Input {...attrs} name="reference" {...referenceInputProps} placeholder="REQ-000001" />}
                </FormField>
                <FormField
                  id="field-quantity"
                  label="Количество"
                  required
                  hint={`От ${quantityInputProps.min} до ${quantityInputProps.max} единиц.`}
                >
                  {(attrs) => (
                    <Input {...attrs} name="quantity" type="number" {...quantityInputProps} defaultValue={25} />
                  )}
                </FormField>
              </div>
              <p className="muted">До 100 единиц включительно — успешное исполнение, больше — бизнес-отказ.</p>
            </fieldset>
            {unresolvedInput ? (
              <Notice role="alert" tone="warning" title="Результат отправки неизвестен">
                Задание могло сохраниться. Повторите исходную отправку, чтобы узнать результат.
              </Notice>
            ) : (
              <ErrorMessage error={create.error} />
            )}
            <CommandRefresh
              message="Задание создано."
              error={refresh.error}
              pending={refresh.isPending}
              onRetry={() => create.data && refreshCreated(create.data.taskId)}
            />
          </div>
          <div className="ui-dialog-footer">
            <Button type="button" onClick={close} disabled={create.isPending}>
              {create.isSuccess ? 'Закрыть' : 'Отмена'}
            </Button>
            {!create.isSuccess && (
              <Button ref={retryButton} variant="default" disabled={create.isPending}>
                {create.isPending ? 'Сохраняем…' : unresolvedInput ? 'Повторить исходную отправку' : 'Создать'}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
      <DiscardDialog
        open={guard.open}
        returnFocusRef={unresolvedInput ? retryButton : titleInput}
        onCancel={guard.cancel}
        onDiscard={guard.discard}
        description={
          unresolvedInput
            ? 'Задание могло сохраниться. Закрыв форму, вы потеряете возможность безопасно повторить эту отправку.'
            : undefined
        }
        discardLabel={unresolvedInput ? 'Закрыть без проверки' : undefined}
        cancelLabel={unresolvedInput ? 'Вернуться к проверке' : undefined}
      />
    </>
  );
}
