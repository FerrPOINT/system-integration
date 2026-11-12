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
  const valid = Number.isSafeInteger(page) && page >= 0 && (!status || status in businessLabels);
  const params = { page, businessStatus: status as BusinessStatus | undefined,
    createdFrom: search.get('createdFrom') || undefined, createdTo: search.get('createdTo') || undefined };
  const tasks = useQuery({ queryKey: [...keys.tasks, 'list', params], queryFn: () => data(listTasks(params)), enabled: valid });
  const mobile = useMediaQuery('(max-width: 760px)');
  function changePage(next: number) {
    const updated = new URLSearchParams(search); updated.set('page', String(next)); setSearch(updated);
  }
  return <>
    <div className="page-heading"><div><h1>{user.role === 'OPERATOR' ? 'Все задания' : 'Мои задания'}</h1>
      <p className="muted">Приём задания, доставка и результат исполнения показаны отдельно.</p></div>
      {user.role === 'INITIATOR' && <Button asChild variant="default"><Link to="/tasks/new">Создать задание</Link></Button>}</div>
    <details className="filter-panel" key={search.toString()} open={!mobile || Boolean(status || params.createdFrom || params.createdTo)}>
    <summary>Фильтры <span>{status || params.createdFrom || params.createdTo ? 'Заданы условия' : 'Результат и период'}</span></summary>
    <form className="filters" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const next = new URLSearchParams();
      if (form.get('businessStatus') !== 'ALL') next.set('businessStatus', String(form.get('businessStatus')));
      for (const name of ['createdFrom', 'createdTo']) {
        if (form.get(name)) next.set(name, String(form.get(name)) + ':00Z');
      }
      setSearch(next);
    }}>
      <label htmlFor="business-status">Результат<Select id="business-status" name="businessStatus" defaultValue={status || 'ALL'}
        options={[{ value: 'ALL', label: 'Все результаты' }, ...Object.entries(businessLabels).map(([value, label]) => ({ value, label }))]} /></label>
      <label>Создано с (UTC, включительно)<Input type="datetime-local" name="createdFrom" defaultValue={params.createdFrom?.slice(0,16)} /></label>
      <label>Создано до (UTC, не включая)<Input type="datetime-local" name="createdTo" defaultValue={params.createdTo?.slice(0,16)} /></label>
      <div className="filter-actions"><Button variant="default">Применить</Button><Button type="button" onClick={() => setSearch({})}>Сбросить</Button></div>
    </form></details>
    {!valid ? <p role="alert">Некорректные параметры страницы. Сбросьте фильтры.</p> : tasks.isPending ? <Loading /> :
      tasks.isError ? <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></> :
      <><div className="list-heading"><span>{tasks.isFetching ? 'Обновляем…' : 'Сохранённые задания'}</span>
        <Button type="button" onClick={() => tasks.refetch()} disabled={tasks.isFetching}>Обновить</Button></div>
        {tasks.data.items.length === 0 ? <section className="panel empty"><h2>{status || params.createdFrom || params.createdTo ? 'Ничего не найдено' : 'Заданий пока нет'}</h2>
          <p>{status || params.createdFrom || params.createdTo ? 'Измените условия или сбросьте фильтры, чтобы увидеть задания.' : 'Создайте первое задание. Здесь появятся доставка и результат исполнения.'}</p>
          {(status || params.createdFrom || params.createdTo) && <Button onClick={() => setSearch({})}>Сбросить фильтры</Button>}</section> : mobile ?
          <ul className="task-cards">{tasks.data.items.map(task => <li className="panel task-card" key={task.taskId}>
            <h2><Link to={'/tasks/' + task.taskId}>{task.title}</Link></h2>
            <div className="task-card-status"><BusinessBadge status={task.businessStatus} /><span>{deliveryLabels[task.deliveryStatus]}</span></div>
            <dl><dt>Заявка</dt><dd>{task.request.reference}</dd><dt>Количество</dt><dd>{task.request.quantity}</dd>
              <dt>Создано</dt><dd>{timestamp(task.createdAt)}</dd></dl>
          </li>)}</ul> :
          <table className="panel task-table"><caption className="sr-only">Реестр заданий</caption>
            <thead><tr><th scope="col">Название / заявка</th><th scope="col">Доставка</th><th scope="col">Результат</th><th scope="col">Создано (UTC)</th></tr></thead>
            <tbody>{tasks.data.items.map(task => <tr key={task.taskId}><td><Link to={'/tasks/' + task.taskId}>{task.title}</Link>
              <small>{task.request.reference} · {task.request.quantity} ед.</small></td><td>{deliveryLabels[task.deliveryStatus]}</td>
              <td><BusinessBadge status={task.businessStatus} /></td><td>{timestamp(task.createdAt)}</td></tr>)}</tbody>
          </table>}
        <Pagination page={page} hasNext={tasks.data.hasNext} pending={tasks.isFetching} onChange={changePage} />
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
      await client.fetchQuery({ queryKey: keys.task(result.taskId), queryFn: () => data(getTask(result.taskId)) });
      await client.invalidateQueries({ queryKey: keys.tasks }, { throwOnError: true });
      command.reset();
      navigate('/tasks/' + result.taskId);
    },
  });
  return <><Link className="back-link" to="/tasks">← К заданиям</Link><h1>Новое задание</h1>
    <section className="panel readable"><p className="muted">Задание сохраняется сразу. Отправка исполнителю продолжится в фоне.</p>
      <form onSubmit={event => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
        <label>Название<Input name="title" required maxLength={160} pattern=".*\S.*" autoFocus /></label>
        <div className="field"><label>Номер заявки<Input name="reference" required pattern="REQ-[0-9]{6}" placeholder="REQ-000001" aria-describedby="reference-hint" /></label>
          <small id="reference-hint">REQ- и шесть цифр. После создания изменить нельзя.</small></div>
        <div className="field"><label>Количество<Input name="quantity" type="number" min={1} max={1000} step={1} required defaultValue={25} aria-describedby="quantity-hint" /></label>
          <small id="quantity-hint">Демонстрационное правило: до 100 единиц включительно — успех, больше — отказ.</small></div>
        <ErrorMessage error={create.error} />
        <div className="actions"><Button variant="default" disabled={create.isPending}>{create.isPending ? 'Сохраняем…' : 'Создать'}</Button>
          <Link to="/tasks">Отмена</Link></div>
      </form>
    </section></>;
}

export function TaskCard({ user }: { user: GetSession200 }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const task = useQuery({ queryKey: keys.task(id), queryFn: async () => {
    const result = await data(getTask(id));
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
  if (!task.data) return <><Link to="/tasks">← К заданиям</Link><ErrorMessage error={task.error} />
    <Button onClick={() => task.refetch()}>Повторить</Button></>;
  const item = task.data;
  return <><Link className="back-link" to="/tasks">← К заданиям</Link>
    <div className="page-heading"><h1>{item.title}</h1><Button onClick={() => task.refetch()} disabled={task.isFetching}>Обновить</Button></div>
    <ErrorMessage error={task.error} />
    <section className="panel"><h2>Состояние задания</h2>
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
    </section>
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
  return <form className="edit-form" onSubmit={event => { event.preventDefault(); rename.mutate(new FormData(event.currentTarget)); }}>
    <label>Новое название<Input name="title" required maxLength={160} pattern=".*\S.*" defaultValue={task.title} autoFocus /></label>
    <ErrorMessage error={rename.error} />
    <div className="actions"><Button variant="default" disabled={rename.isPending || conflict}>Сохранить</Button>
      <Button type="button" onClick={async () => { await client.invalidateQueries({ queryKey: keys.task(task.taskId) }); onClose(); }}>
        {conflict ? 'Обновить карточку' : 'Отмена'}</Button></div>
  </form>;
}

function History({ id, canReview }: { id: string; canReview: boolean }) {
  const [page, setPage] = useState(0);
  const history = useQuery({ queryKey: keys.history(id, page), queryFn: () => data(listTaskHistory(id, { page })) });
  return <section className="panel history"><h2>История</h2>
    {history.isPending ? <Loading /> : history.isError ? <><ErrorMessage error={history.error} />
      <Button onClick={() => history.refetch()}>Повторить</Button></> : <>
      <ol>{history.data.items.map(event => <li key={event.eventId}>
        <p>{event.summary}</p><small><time dateTime={event.occurredAt}>{timestamp(event.occurredAt)}</time> ·
          {event.actor === 'SYSTEM' ? ' Система' : ` Пользователь ${event.actorUserId}`}</small>
        {canReview && event.reconciliationId && <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>Открыть сохранённую сверку</Link>}
        {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
      </li>)}</ol>
      <Pagination page={page} hasNext={history.data.hasNext} pending={history.isFetching} onChange={setPage} />
    </>}
  </section>;
}
