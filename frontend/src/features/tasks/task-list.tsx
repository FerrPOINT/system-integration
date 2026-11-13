import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { Disclosure } from '../../ui/disclosure';
import { Table } from '../../ui/table';
import { EmptyState } from '../../ui/empty-state';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { listTasks } from '../../../build/generated/openapi/client';
import type { BusinessStatus, GetSession200 } from '../../../build/generated/openapi/client';
import { data, keys } from '../../app/api';
import { Loading, Pagination } from '../../ui/Feedback';
import { useMediaQuery } from '../../ui/use-media-query';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { BusinessBadge } from './business-badge';

export function TaskList({ user }: { user: GetSession200 }) {
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') || 0);
  const status = search.get('businessStatus') || undefined;
  const params = { page, businessStatus: status as BusinessStatus | undefined,
    createdFrom: search.get('createdFrom') || undefined, createdTo: search.get('createdTo') || undefined };
  const validParameters = Number.isSafeInteger(page) && page >= 0 &&
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
    {!valid ? <Notice role="alert" tone="danger">{validParameters ? 'Начало периода должно быть раньше конца.' : 'Некорректные параметры страницы. Сбросьте фильтры.'}</Notice> : tasks.isPending ? <Loading /> :
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
