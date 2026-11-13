import { ErrorMessage } from '../../app/error-message';
import { BackLink } from '../../ui/back-link';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createTask, getTask } from '../../../build/generated/openapi/client';
import { csrf, data, keys } from '../../app/api';
import { useCommandKey } from '../../app/use-command-key';

export function NewTask() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const command = useCommandKey();
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const input = { title: String(form.get('title')), request: { reference: String(form.get('reference')), quantity: Number(form.get('quantity')) } };
      return data(createTask(input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: async result => {
      await client.fetchQuery({ queryKey: keys.task(result.taskId), queryFn: ({ signal }) => data(getTask(result.taskId, { signal })) });
      await client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true });
      command.reset();
      navigate('/tasks/' + result.taskId);
    },
  });
  return <><BackLink to="/tasks">К заданиям</BackLink><PageHeader title="Новое задание" />
    <Card asChild><section className="readable"><CardContent className="base-page-stack"><p className="muted">Задание сохраняется сразу. Отправка исполнителю продолжится в фоне.</p>
      <form className="base-form" onSubmit={event => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
        <FormField id="field-title" label="Название" required>{attrs => <Input {...attrs} name="title" maxLength={160} pattern=".*\S.*" autoFocus />}</FormField>
        <FormField id="field-reference" label="Номер заявки" required hint="REQ- и шесть цифр. После создания изменить нельзя.">{attrs => <Input {...attrs} name="reference" pattern="REQ-[0-9]{6}" placeholder="REQ-000001" />}</FormField>
        <FormField id="field-quantity" label="Количество" required hint="Демонстрационное правило: до 100 единиц включительно — успех, больше — отказ.">{attrs => <Input {...attrs} name="quantity" type="number" min={1} max={1000} step={1} defaultValue={25} />}</FormField>
        <ErrorMessage error={create.error} />
        <ActionGroup align="start"><Button variant="default" disabled={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Создать'}</Button>
          <Link to="/tasks">Отмена</Link></ActionGroup>
      </form>
    </CardContent></section></Card></>;
}
