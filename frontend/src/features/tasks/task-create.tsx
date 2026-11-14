import { ErrorMessage } from '../../app/error-message';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dialog, DiscardDialog } from '../../ui/dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBeforeUnload, useBlocker, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { createTask, getTask } from '../../../build/generated/openapi/client';
import { csrf, data, keys } from '../../app/api';
import { useCommandKey } from '../../app/use-command-key';

export function NewTask() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const returnFocusRef = useOutletContext<RefObject<HTMLAnchorElement | null>>();
  const titleInput = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  const saved = useRef(false);
  const client = useQueryClient();
  const command = useCommandKey();
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const input = {
        title: String(form.get('title')),
        request: { reference: String(form.get('reference')), quantity: Number(form.get('quantity')) },
      };
      return data(createTask(input, { ...(await csrf()), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: async (result) => {
      await client.fetchQuery({
        queryKey: keys.task(result.taskId),
        queryFn: ({ signal }) => data(getTask(result.taskId, { signal })),
      });
      await client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true });
      command.reset();
      saved.current = true;
      if (blocker.state === 'blocked') blocker.reset();
      navigate('/tasks/' + result.taskId);
    },
  });
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !saved.current && (dirty || create.isPending) && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === 'blocked' && create.isPending) blocker.reset();
  }, [blocker, create.isPending]);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!saved.current && (dirty || create.isPending)) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty, create.isPending],
    ),
  );
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
          className="base-dialog-form"
          onChange={(event) => {
            const form = new FormData(event.currentTarget);
            setDirty(Boolean(form.get('title') || form.get('reference') || form.get('quantity') !== '25'));
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending) create.mutate(new FormData(event.currentTarget));
          }}
        >
          <div className="base-dialog-body base-page-stack">
            <fieldset className="base-form-fieldset base-form" disabled={create.isPending} aria-label="Данные задания">
              <FormField id="field-title" label="Название" required>
                {(attrs) => (
                  <Input {...attrs} ref={titleInput} name="title" maxLength={160} pattern=".*\S.*" autoFocus />
                )}
              </FormField>
              <div className="task-input-row">
                <FormField
                  id="field-reference"
                  label="Номер заявки"
                  required
                  hint="REQ- и шесть цифр. После создания изменить нельзя."
                >
                  {(attrs) => <Input {...attrs} name="reference" pattern="REQ-[0-9]{6}" placeholder="REQ-000001" />}
                </FormField>
                <FormField id="field-quantity" label="Количество" required hint="От 1 до 1000 единиц.">
                  {(attrs) => (
                    <Input {...attrs} name="quantity" type="number" min={1} max={1000} step={1} defaultValue={25} />
                  )}
                </FormField>
              </div>
              <p className="muted">До 100 единиц включительно — успешное исполнение, больше — бизнес-отказ.</p>
            </fieldset>
            <ErrorMessage error={create.error} />
          </div>
          <div className="base-dialog-footer">
            <Button type="button" onClick={close} disabled={create.isPending}>
              Отмена
            </Button>
            <Button variant="default" disabled={create.isPending}>
              {create.isPending ? 'Сохраняем…' : 'Создать'}
            </Button>
          </div>
        </form>
      </Dialog>
      <DiscardDialog
        open={blocker.state === 'blocked' && !create.isPending}
        returnFocusRef={titleInput}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
        onDiscard={() => blocker.state === 'blocked' && blocker.proceed()}
      />
    </>
  );
}
