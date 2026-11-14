import { ErrorMessage } from '../../shared/ui/error-message';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { Button } from '../../shared/ui/button';
import { CommandRefresh } from '../../shared/ui/command-refresh';
import { useRef, useState, type RefObject } from 'react';
import { Dialog, DiscardDialog } from '../../shared/ui/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { createTask, getTask } from '../../../build/generated/openapi/client';
import { taskKeys } from './api/task-keys';
import { data } from '../../shared/api/http';
import { csrf } from '../../shared/api/csrf';
import { useCommandKey } from '../../shared/lib/forms/use-command-key';
import { useFormNavigationGuard } from '../../shared/lib/forms/use-form-navigation-guard';

export function NewTask() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const returnFocusRef = useOutletContext<RefObject<HTMLAnchorElement | null>>();
  const titleInput = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  const client = useQueryClient();
  const command = useCommandKey();
  const refresh = useMutation({
    mutationFn: async (id: string) => {
      await client.fetchQuery({ queryKey: taskKeys.task(id), queryFn: ({ signal }) => data(getTask(id, { signal })) });
      await client.invalidateQueries({ queryKey: taskKeys.tasks }, { throwOnError: true });
    },
  });
  const refreshCreated = (id: string) => refresh.mutate(id, {
    // Per-call callbacks do not redirect after the user has left this component.
    onSuccess: () => navigate('/tasks/' + id),
  });
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const input = { title: String(form.get('title')), request: { reference: String(form.get('reference')), quantity: Number(form.get('quantity')) } };
      return data(createTask(input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: result => {
      command.reset(); guard.release();
      refreshCreated(result.taskId);
    },
  });
  const guard = useFormNavigationGuard({ dirty, pending: create.isPending });
  const close = () => navigate({ pathname: '/tasks', search: search.toString() }, { replace: true });
  return <>
    <Dialog open title="Новое задание" description="Задание сохранится сразу, отправка исполнителю продолжится в фоне."
      onClose={close} pending={create.isPending} returnFocusRef={returnFocusRef}>
      <form className="base-dialog-form" onChange={event => {
        const form = new FormData(event.currentTarget);
        setDirty(Boolean(form.get('title') || form.get('reference') || form.get('quantity') !== '25'));
      }} onSubmit={event => { event.preventDefault(); if (!create.isPending && !create.isSuccess) create.mutate(new FormData(event.currentTarget)); }}>
        <div className="base-dialog-body base-page-stack">
          <fieldset className="base-form-fieldset base-form" disabled={create.isPending || create.isSuccess} aria-label="Данные задания">
            <FormField id="field-title" label="Название" required>{attrs => <Input {...attrs} ref={titleInput} name="title" maxLength={160} pattern=".*\S.*" autoFocus />}</FormField>
            <div className="task-input-row">
              <FormField id="field-reference" label="Номер заявки" required hint="REQ- и шесть цифр. После создания изменить нельзя.">{attrs => <Input {...attrs} name="reference" pattern="REQ-[0-9]{6}" placeholder="REQ-000001" />}</FormField>
              <FormField id="field-quantity" label="Количество" required hint="От 1 до 1000 единиц.">{attrs => <Input {...attrs} name="quantity" type="number" min={1} max={1000} step={1} defaultValue={25} />}</FormField>
            </div>
            <p className="muted">До 100 единиц включительно — успешное исполнение, больше — бизнес-отказ.</p>
          </fieldset>
          <ErrorMessage error={create.error} />
          <CommandRefresh message="Задание создано." error={refresh.error} pending={refresh.isPending}
            onRetry={() => create.data && refreshCreated(create.data.taskId)} />
        </div>
        <div className="base-dialog-footer">
          <Button type="button" onClick={close} disabled={create.isPending}>{create.isSuccess ? 'Закрыть' : 'Отмена'}</Button>
          {!create.isSuccess && <Button variant="default" disabled={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Создать'}</Button>}
        </div>
      </form>
    </Dialog>
    <DiscardDialog open={guard.open} returnFocusRef={titleInput} onCancel={guard.cancel} onDiscard={guard.discard} />
  </>;
}
