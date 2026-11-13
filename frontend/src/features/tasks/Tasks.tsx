import { ErrorMessage } from '../../app/error-message';
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
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dialog, DiscardDialog } from '../../ui/dialog';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useBeforeUnload, useBlocker, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { createTask, getTask, listTaskHistory, listTasks, renameTask } from '../../../build/generated/openapi/client';
import type { BusinessStatus, GetSession200, Task } from '../../../build/generated/openapi/client';
import { ApiError, csrf, data, keys } from '../../app/api';
import { Loading, Pagination, RefreshButton } from '../../ui/Feedback';
import { useMediaQuery } from '../../ui/use-media-query';
import { useCommandKey } from '../../app/use-command-key';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { ReconcileButton } from '../operations/Operations';
import { taskRefreshInterval } from './refresh-interval';
import { usePagination } from '../../app/use-pagination';

function BusinessBadge({ status }: { status: BusinessStatus }) {
  return <Badge tone={status === 'SUCCEEDED' ? 'success' : status === 'REJECTED' ? 'danger' : status === 'RUNNING' ? 'info' : 'neutral'}>{businessLabels[status]}</Badge>;
}

export function TaskList({ user }: { user: GetSession200 }) {
  const createTrigger = useRef<HTMLAnchorElement>(null);
  const [search, setSearch] = useSearchParams();
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination();
  const status = search.get('businessStatus') || undefined;
  const params = { page, size, businessStatus: status as BusinessStatus | undefined,
    createdFrom: search.get('createdFrom') || undefined, createdTo: search.get('createdTo') || undefined };
  const validParameters = validPage &&
    (!status || Object.hasOwn(businessLabels, status)) &&
    [params.createdFrom, params.createdTo].every(value => !value || Number.isFinite(Date.parse(value)));
  const validPeriod = !params.createdFrom || !params.createdTo || Date.parse(params.createdFrom) < Date.parse(params.createdTo);
  const valid = validParameters && validPeriod;
  function changeFilters(changes: Record<string, string | undefined>) {
    const updated = new URLSearchParams(search);
    updated.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value) updated.set(key, value); else updated.delete(key);
    }
    setSearch(updated, { replace: true });
  }
  const tasks = useQuery({ queryKey: [...keys.tasks, 'list', params], queryFn: ({ signal }) => data(listTasks(params, { signal })), enabled: valid, placeholderData: keepPreviousData });
  const mobile = useMediaQuery('(max-width: 760px)');
  const [filtersOpen, setFiltersOpen] = useState(!mobile || Boolean(status || params.createdFrom || params.createdTo));
  return <>
    <div className="list-tools base-page-stack"><PageHeader title={user.role === 'OPERATOR' ? 'Все задания' : 'Мои задания'}
      context="Приём задания, доставка и результат исполнения показаны отдельно."
      actions={<>{user.role === 'INITIATOR' && <Button asChild variant="default"><Link ref={createTrigger} to={{ pathname: "/tasks/new", search: search.toString() }}>Создать задание</Link></Button>}
        <RefreshButton pending={tasks.isFetching} disabled={!valid} onClick={() => tasks.refetch()} /></>} />
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
    </div>
    <section className="paged-list base-page-stack" aria-busy={tasks.isFetching}>
    <div className="paged-viewport" ref={viewportRef}>
    {!valid ? <Notice role="alert" tone="danger">{validParameters ? 'Начало периода должно быть раньше конца.' : 'Некорректные параметры страницы. Сбросьте фильтры.'}</Notice> : tasks.isPending ? <Loading /> :
      tasks.isError ? <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></> :
        tasks.data.items.length === 0 ? <Card><EmptyState headingLevel={2}
          message={status || params.createdFrom || params.createdTo ? 'Ничего не найдено' : 'Заданий пока нет'}
          description={status || params.createdFrom || params.createdTo ? 'Измените условия или сбросьте фильтры, чтобы увидеть задания.' : 'Создайте первое задание. Здесь появятся доставка и результат исполнения.'}
          action={(status || params.createdFrom || params.createdTo) && <Button onClick={() => setSearch({})}>Сбросить фильтры</Button>} /></Card> : mobile ?
          <ul className="task-cards" data-page-items>{tasks.data.items.slice(0, size).map(task => <Card asChild key={task.taskId} data-page-item><li className="task-card"><CardContent className="base-page-stack">
            <CardTitle asChild><h2><Link className="base-truncate" title={task.title} to={'/tasks/' + task.taskId}>{task.title}</Link></h2></CardTitle>
            <div className="task-card-status"><BusinessBadge status={task.businessStatus} /><span>{deliveryLabels[task.deliveryStatus]}</span></div>
            <dl><dt>Заявка</dt><dd>{task.request.reference}</dd><dt>Количество</dt><dd>{task.request.quantity}</dd>
              <dt>Создано</dt><dd>{timestamp(task.createdAt)}</dd></dl>
          </CardContent></li></Card>)}</ul> :
          <Card><Table className="task-table" data-page-items><caption className="sr-only">Реестр заданий</caption>
            <thead data-page-heading><tr><th scope="col">Название / заявка</th><th scope="col">Доставка</th><th scope="col">Результат</th><th scope="col">Создано (UTC)</th></tr></thead>
            <tbody>{tasks.data.items.slice(0, size).map(task => <tr key={task.taskId} data-page-item><td><Link className="base-truncate" title={task.title} to={'/tasks/' + task.taskId}>{task.title}</Link>
              <small>{task.request.reference} · {task.request.quantity} ед.</small></td><td>{deliveryLabels[task.deliveryStatus]}</td>
              <td><BusinessBadge status={task.businessStatus} /></td><td>{timestamp(task.createdAt)}</td></tr>)}</tbody>
          </Table></Card>}
    </div>
    <Pagination page={validPage ? page : 0} totalItems={tasks.data?.totalItems ?? 0} totalPages={tasks.data?.totalPages ?? 0} pending={tasks.isFetching || !valid} onChange={changePage} />
    </section>
    <Outlet context={createTrigger} />
  </>;
}

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
      const input = { title: String(form.get('title')), request: { reference: String(form.get('reference')), quantity: Number(form.get('quantity')) } };
      return data(createTask(input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: async result => {
      await client.fetchQuery({ queryKey: keys.task(result.taskId), queryFn: ({ signal }) => data(getTask(result.taskId, { signal })) });
      await client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true });
      command.reset(); saved.current = true;
      if (blocker.state === 'blocked') blocker.reset();
      navigate('/tasks/' + result.taskId);
    },
  });
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !saved.current && (dirty || create.isPending) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked' && create.isPending) blocker.reset();
  }, [blocker, create.isPending]);
  useBeforeUnload(useCallback(event => {
    if (!saved.current && (dirty || create.isPending)) { event.preventDefault(); event.returnValue = ''; }
  }, [dirty, create.isPending]));
  const close = () => navigate({ pathname: '/tasks', search: search.toString() }, { replace: true });
  return <>
    <Dialog open title="Новое задание" description="Задание сохранится сразу, отправка исполнителю продолжится в фоне."
      onClose={close} pending={create.isPending} returnFocusRef={returnFocusRef}>
      <form className="base-dialog-form" onChange={event => {
        const form = new FormData(event.currentTarget);
        setDirty(Boolean(form.get('title') || form.get('reference') || form.get('quantity') !== '25'));
      }} onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(new FormData(event.currentTarget)); }}>
        <div className="base-dialog-body base-page-stack">
          <fieldset className="base-form-fieldset base-form" disabled={create.isPending} aria-label="Данные задания">
            <FormField id="field-title" label="Название" required>{attrs => <Input {...attrs} ref={titleInput} name="title" maxLength={160} pattern=".*\S.*" autoFocus />}</FormField>
            <div className="task-input-row">
              <FormField id="field-reference" label="Номер заявки" required hint="REQ- и шесть цифр. После создания изменить нельзя.">{attrs => <Input {...attrs} name="reference" pattern="REQ-[0-9]{6}" placeholder="REQ-000001" />}</FormField>
              <FormField id="field-quantity" label="Количество" required hint="От 1 до 1000 единиц.">{attrs => <Input {...attrs} name="quantity" type="number" min={1} max={1000} step={1} defaultValue={25} />}</FormField>
            </div>
            <p className="muted">До 100 единиц включительно — успешное исполнение, больше — бизнес-отказ.</p>
          </fieldset>
          <ErrorMessage error={create.error} />
        </div>
        <div className="base-dialog-footer">
          <Button type="button" onClick={close} disabled={create.isPending}>Отмена</Button>
          <Button variant="default" disabled={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Создать'}</Button>
        </div>
      </form>
    </Dialog>
    <DiscardDialog open={blocker.state === 'blocked' && !create.isPending} returnFocusRef={titleInput}
      onCancel={() => blocker.state === 'blocked' && blocker.reset()}
      onDiscard={() => blocker.state === 'blocked' && blocker.proceed()} />
  </>;
}

export function TaskCard({ user }: { user: GetSession200 }) {
  const { id = '' } = useParams();
  const task = useQuery({
    queryKey: keys.task(id),
    queryFn: ({ signal }) => data(getTask(id, { signal })),
    refetchInterval: query => taskRefreshInterval(query.state.data),
  });
  const [editing, setEditing] = useState(false);
  if (task.isPending) return <Loading />;
  if (!task.data) return <><BackLink to="/tasks">К заданиям</BackLink><ErrorMessage error={task.error} />
    <Button onClick={() => task.refetch()}>Повторить</Button></>;
  const item = task.data;
  return <><BackLink to="/tasks">К заданиям</BackLink>
    <PageHeader title={item.title} actions={<RefreshButton pending={task.isFetching} onClick={() => task.refetch()} />} />
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
    <History id={id} canReview={user.role === 'OPERATOR'} refreshInterval={taskRefreshInterval(item)} />
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

function History({ id, canReview, refreshInterval }: { id: string; canReview: boolean; refreshInterval: number | false }) {
  const { page, size, valid, viewportRef, changePage } = usePagination();
  const history = useQuery({ queryKey: keys.history(id, page, size), enabled: valid,
    queryFn: ({ signal }) => data(listTaskHistory(id, { page, size }, { signal })), refetchInterval: refreshInterval, placeholderData: keepPreviousData });
  return <Card asChild><section className="history-panel"><CardContent className="paged-list base-page-stack" aria-busy={history.isFetching}><CardTitle asChild><h2>История</h2></CardTitle>
    <div className="paged-viewport" ref={viewportRef}>
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : history.isPending ? <Loading /> : history.isError ? <><ErrorMessage error={history.error} />
      <Button onClick={() => history.refetch()}>Повторить</Button></> : <>
      <Timeline data-page-items>{history.data.items.slice(0, size).map(event => <TimelineItem key={event.eventId} data-page-item data-event-id={event.eventId}><TimelineMarker /><TimelineContent>
        <p className="base-truncate" title={event.summary}>{event.summary}</p><small><time dateTime={event.occurredAt}>{timestamp(event.occurredAt)}</time> ·
          {event.actor === 'SYSTEM' ? ' Система' : ` Пользователь ${event.actorUserId}`}</small>
        {canReview && event.reconciliationId && <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>Открыть сохранённую сверку</Link>}
        {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
      </TimelineContent></TimelineItem>)}</Timeline>
    </>}
    </div>
    <Pagination page={valid ? page : 0} totalItems={history.data?.totalItems ?? 0} totalPages={history.data?.totalPages ?? 0} pending={history.isFetching || !valid} onChange={changePage} />
  </CardContent></section></Card>;
}
