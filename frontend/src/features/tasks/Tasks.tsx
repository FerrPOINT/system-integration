import { Notice } from '../../ui/notice';
import { BackLink } from '../../ui/back-link';
import { Timeline, TimelineItem, TimelineMarker, TimelineContent } from '../../ui/timeline';
import { Disclosure } from '../../ui/disclosure';
import { Table } from '../../ui/table';
import { EmptyState } from '../../ui/empty-state';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Badge } from '../../ui/badge';
import { Select } from '../../ui/select';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createTask, getTask, listTaskHistory, listTasks, renameTask } from '../../../build/generated/openapi/client';
import type { BusinessStatus, GetSession200, Task } from '../../../build/generated/openapi/client';
import { ApiError, csrf, data, keys } from '../../app/api';
import { ErrorMessage, Loading, Pagination } from '../../ui/Feedback';
import { useMediaQuery } from '../../ui/use-media-query';
import { useCommandKey } from '../../app/use-command-key';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { ReconcileButton } from '../operations/Operations';

function BusinessBadge({ status }: { status: BusinessStatus }) {
  return <Badge tone={status === 'SUCCEEDED' ? 'success' : status === 'REJECTED' ? 'danger' : status === 'RUNNING' ? 'info' : 'neutral'}>{businessLabels[status]}</Badge>;
}

export function TaskList({ user }: { user: GetSession200 }) {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') || 0);
  const status = search.get('businessStatus') || undefined;
  const validPage = Number.isSafeInteger(page) && page >= 0 && (!status || status in businessLabels);
  const params = { page, businessStatus: status as BusinessStatus | undefined,
    createdFrom: search.get('createdFrom') || undefined, createdTo: search.get('createdTo') || undefined };
  const validPeriod = !params.createdFrom || !params.createdTo || Date.parse(params.createdFrom) < Date.parse(params.createdTo);
  const valid = validPage && validPeriod;
  function changeFilters(changes: Record<string, string | undefined>) {
    const updated = new URLSearchParams(search);
    updated.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) updated.set(key, value); else updated.delete(key);
    }
    setSearch(updated, { replace: true });
  }
  const tasks = useQuery({ queryKey: [...keys.tasks, 'list', params], queryFn: ({ signal }) => data(listTasks(params, { signal })), enabled: valid });
  const mobile = useMediaQuery('(max-width: 760px)');
  const [filtersOpen, setFiltersOpen] = useState(!mobile || Boolean(status || params.createdFrom || params.createdTo));
  function changePage(next: number) {
    const updated = new URLSearchParams(search); updated.set('page', String(next)); setSearch(updated);
  }
  return <>
    <PageHeader title={user.role === 'OPERATOR' ? 'Все задания' : 'Мои задания'}
      context="Приём задания, доставка и результат исполнения показаны отдельно."
      actions={user.role === 'INITIATOR' && <Button asChild variant="default"><Link to="/tasks/new">Создать задание</Link></Button>} />
    <Disclosure className="filter-panel" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)} summary={<>Фильтры <span className="muted">{status || params.createdFrom || params.createdTo ? 'Заданы условия' : 'Результат и период'}</span></>}>
    <div className="base-form filters">
      <FormField id="business-status" label="Результат">{attrs => <Select {...attrs} value={status || 'ALL'}
        onValueChange={value => changeFilters({ businessStatus: value === 'ALL' ? undefined : value })}
        options={[{ value: 'ALL', label: 'Все результаты' }, ...Object.entries(businessLabels).map(([value, label]) => ({ value, label }))]} />}</FormField>
      <FormField id="field-createdFrom" label="Создано с (UTC, включительно)">{attrs => <Input {...attrs} type="datetime-local" name="createdFrom" value={params.createdFrom?.slice(0,16) || ''}
        onChange={event => changeFilters({ createdFrom: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <FormField id="field-createdTo" label="Создано до (UTC, не включая)">{attrs => <Input {...attrs} type="datetime-local" name="createdTo" value={params.createdTo?.slice(0,16) || ''}
        onChange={event => changeFilters({ createdTo: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <Button type="button" onClick={() => setSearch({}, { replace: true })}>Сбросить</Button>
    </div></Disclosure>
    {!valid ? <Notice role="alert" tone="danger">{validPage ? 'Начало периода должно быть раньше конца.' : 'Некорректные параметры страницы. Сбросьте фильтры.'}</Notice> : tasks.isPending ? <Loading /> :
      tasks.isError ? <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></> :
      <><div className="list-heading"><span>{tasks.isFetching ? 'Обновляем…' : 'Сохранённые задания'}</span>
        <Button type="button" onClick={() => tasks.refetch()} disabled={tasks.isFetching}>Обновить</Button></div>
        {tasks.data.items.length === 0 ? <Card><EmptyState headingLevel={2}
          message={status || params.createdFrom || params.createdTo ? 'Ничего не найдено' : 'Заданий пока нет'}
          description={status || params.createdFrom || params.createdTo ? 'Измените условия или сбросьте фильтры, чтобы увидеть задания.' : 'Создайте первое задание. Здесь появятся доставка и результат исполнения.'}
          action={(status || params.createdFrom || params.createdTo) && <Button onClick={() => setSearch({})}>Сбросить фильтры</Button>} /></Card> : mobile ?
          <ul className="task-cards">{tasks.data.items.map(task => <Card asChild key={task.taskId}><li className="task-card"><CardContent className="base-page-stack">
            <CardTitle asChild><h2><Link to={'/tasks/' + task.taskId}>{task.title}</Link></h2></CardTitle>
            <div className="task-card-status"><BusinessBadge status={task.businessStatus} /><span>{deliveryLabels[task.deliveryStatus]}</span></div>
            <dl><dt>Заявка</dt><dd>{task.request.reference}</dd><dt>Количество</dt><dd>{task.request.quantity}</dd>
              <dt>Создано</dt><dd>{timestamp(task.createdAt)}</dd></dl>
          </CardContent></li></Card>)}</ul> :
          <Card><Table className="task-table"><caption className="sr-only">Реестр заданий</caption>
            <thead><tr><th scope="col">Название / заявка</th><th scope="col">Доставка</th><th scope="col">Результат</th><th scope="col">Создано (UTC)</th></tr></thead>
            <tbody>{tasks.data.items.map(task => <tr key={task.taskId}><td><Link to={'/tasks/' + task.taskId}>{task.title}</Link>
              <small>{task.request.reference} · {task.request.quantity} ед.</small></td><td>{deliveryLabels[task.deliveryStatus]}</td>
              <td><BusinessBadge status={task.businessStatus} /></td><td>{timestamp(task.createdAt)}</td></tr>)}</tbody>
          </Table></Card>}
        <Pagination page={page} totalItems={tasks.data.totalItems} totalPages={tasks.data.totalPages} pending={tasks.isFetching} onChange={changePage} />
      </>}
  </>;
}

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

export function TaskCard({ user }: { user: GetSession200 }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const task = useQuery({ queryKey: keys.task(id), queryFn: async ({ signal }) => {
    const result = await data(getTask(id, { signal }));
    void client.invalidateQueries({ queryKey: [...keys.task(id), 'history'] });
    return result;
  },
    refetchInterval: query => {
      const current = query.state.data;
      return current && !['SUCCEEDED', 'REJECTED'].includes(current.businessStatus) ? 3000 : false;
    },
  });
  const [editing, setEditing] = useState(false);
  if (task.isPending) return <Loading />;
  if (!task.data) return <><BackLink to="/tasks">К заданиям</BackLink><ErrorMessage error={task.error} />
    <Button onClick={() => task.refetch()}>Повторить</Button></>;
  const item = task.data;
  return <><BackLink to="/tasks">К заданиям</BackLink>
    <PageHeader title={item.title} actions={<Button onClick={() => task.refetch()} disabled={task.isFetching}>Обновить</Button>} />
    <ErrorMessage error={task.error} />
    <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h2>Состояние задания</h2></CardTitle>
      <dl className="details"><dt>Доставка</dt><dd>{deliveryLabels[item.deliveryStatus]}</dd>
        <dt>Исполнение</dt><dd><BusinessBadge status={item.businessStatus} /></dd>
        <dt>Заявка</dt><dd>{item.request.reference}</dd><dt>Количество</dt><dd>{item.request.quantity}</dd>
        <dt>Создано</dt><dd>{timestamp(item.createdAt)}</dd>
        <dt>ID операции</dt><dd className="technical">{item.operationId}</dd>
        {item.result && <><dt>Завершено</dt><dd>{timestamp(item.result.completedAt)}</dd>
          {item.result.rejectionCode && <><dt>Причина отказа</dt><dd>Количество превышает 100 единиц</dd></>}</>}
      </dl>
      {user.role === 'INITIATOR' && (editing ? <RenameForm task={item} onClose={() => setEditing(false)} /> :
        <Button onClick={() => setEditing(true)}>Изменить название</Button>)}
      {user.role === 'OPERATOR' && <ReconcileButton taskId={id} />}
    </CardContent></section></Card>
    <History id={id} canReview={user.role === 'OPERATOR'} />
  </>;
}

function RenameForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const client = useQueryClient();
  const command = useCommandKey();
  const [revision] = useState(task.titleRevision);
  const rename = useMutation({
    mutationFn: async (form: FormData) => {
      const input = { title: String(form.get('title')), expectedTitleRevision: revision };
      return data(renameTask(task.taskId, input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: async () => {
      // A replayed receipt may be older than the task: read current state after every success.
      await client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true });
      command.reset(); onClose();
    },
  });
  const conflict = rename.error instanceof ApiError && rename.error.status === 409;
  return <form className="base-form edit-form" onSubmit={event => { event.preventDefault(); rename.mutate(new FormData(event.currentTarget)); }}>
    <FormField id="field-title" label="Новое название" required>{attrs => <Input {...attrs} name="title" maxLength={160} pattern=".*\S.*" defaultValue={task.title} autoFocus />}</FormField>
    <ErrorMessage error={rename.error} />
    <ActionGroup align="start"><Button variant="default" disabled={rename.isPending || conflict}>Сохранить</Button>
      <Button type="button" onClick={async () => { await client.invalidateQueries({ queryKey: keys.task(task.taskId) }); onClose(); }}>
        {conflict ? 'Обновить карточку' : 'Отмена'}</Button></ActionGroup>
  </form>;
}

function History({ id, canReview }: { id: string; canReview: boolean }) {
  const [page, setPage] = useState(0);
  const history = useQuery({ queryKey: keys.history(id, page), queryFn: ({ signal }) => data(listTaskHistory(id, { page }, { signal })) });
  return <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h2>История</h2></CardTitle>
    {history.isPending ? <Loading /> : history.isError ? <><ErrorMessage error={history.error} />
      <Button onClick={() => history.refetch()}>Повторить</Button></> : <>
      <Timeline>{history.data.items.map(event => <TimelineItem key={event.eventId}><TimelineMarker /><TimelineContent>
        <p>{event.summary}</p><small><time dateTime={event.occurredAt}>{timestamp(event.occurredAt)}</time> ·
          {event.actor === 'SYSTEM' ? ' Система' : ` Пользователь ${event.actorUserId}`}</small>
        {canReview && event.reconciliationId && <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>Открыть сохранённую сверку</Link>}
        {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
      </TimelineContent></TimelineItem>)}</Timeline>
      <Pagination page={page} totalItems={history.data.totalItems} totalPages={history.data.totalPages} pending={history.isFetching} onChange={setPage} />
    </>}
  </CardContent></section></Card>;
}
