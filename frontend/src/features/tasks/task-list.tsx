import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { Disclosure } from '../../ui/disclosure';
import { Table } from '../../ui/table';
import { EmptyState } from '../../ui/empty-state';
import { Card, CardContent } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Select } from '../../ui/select';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Dialog } from '../../ui/dialog';
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { listTasks } from '../../../build/generated/openapi/client';
import type { BusinessStatus, GetSession200 } from '../../../build/generated/openapi/client';
import { keys } from '../../app/api';
import { data } from '../../shared/api/http';
import { Loading, Pagination, RefreshButton } from '../../ui/Feedback';
import { useMediaQuery } from '../../ui/use-media-query';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';
import { usePagination } from '../../app/use-pagination';
import { BusinessBadge } from './business-badge';
import { useCollectionQuery } from '../../app/use-collection-query';
import { FeedFooter } from '../../ui/feed-footer';

export function TaskList({ user }: { user: GetSession200 }) {
  const createTrigger = useRef<HTMLAnchorElement>(null);
  const mobile = useMediaQuery('(max-width: 760px)');
  const location = useLocation();
  const returnState = { returnTo: location.pathname + location.search };
  const [search, setSearch] = useSearchParams();
  const { page, size, valid: validPage, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
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
  const tasks = useCollectionQuery({ key: keys.taskList(params), page, size, feed: mobile, enabled: valid,
    read: (page, size, signal) => data(listTasks({ ...params, page, size }, { signal })), identify: task => task.taskId });
  const [filtersOpen, setFiltersOpen] = useState(true);
  const hasFilters = Boolean(status || params.createdFrom || params.createdTo);
  const filterFields = <div className="base-form filters">
      <FormField id="business-status" label="Результат">{attrs => <Select {...attrs} value={status || 'ALL'}
        onValueChange={value => changeFilters({ businessStatus: value === 'ALL' ? undefined : value })}
        options={[{ value: 'ALL', label: 'Все результаты' }, ...Object.entries(businessLabels).map(([value, label]) => ({ value, label }))]} />}</FormField>
      <FormField id="field-createdFrom" label="Создано с (UTC, включительно)">{attrs => <Input {...attrs} type="datetime-local" name="createdFrom" value={params.createdFrom?.slice(0,16) || ''}
        onChange={event => changeFilters({ createdFrom: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <FormField id="field-createdTo" label="Создано до (UTC, не включая)">{attrs => <Input {...attrs} type="datetime-local" name="createdTo" value={params.createdTo?.slice(0,16) || ''}
        onChange={event => changeFilters({ createdTo: event.target.value ? event.target.value + ':00Z' : undefined })} />}</FormField>
      <Button type="button" onClick={() => setSearch({}, { replace: true })}>Сбросить</Button>
      {mobile && !validPeriod && <Notice role="alert" tone="danger">Начало периода должно быть раньше конца.</Notice>}
    </div>;
  return <>
    <div className="list-tools base-page-stack"><PageHeader title={user.role === 'OPERATOR' ? 'Все задания' : 'Мои задания'}
      context={mobile ? tasks.data && `Всего: ${tasks.data.totalItems}` : 'Приём задания, доставка и результат исполнения показаны отдельно.'}
      actions={<>{user.role === 'INITIATOR' && <Button asChild variant="default"><Link ref={createTrigger} className={mobile ? 'base-icon-button' : undefined} aria-label="Создать задание" title="Создать задание" to={{ pathname: "/tasks/new", search: search.toString() }}>{mobile ? <Plus size={20} aria-hidden="true" /> : 'Создать задание'}</Link></Button>}
        {mobile && <MobileTaskFilters active={hasFilters}>{filterFields}</MobileTaskFilters>}
        <RefreshButton pending={tasks.isFetching} disabled={!valid} onClick={() => tasks.refetch()} /></>} />
    {!mobile &&
      <Disclosure className="filter-panel" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}
        summaryProps={{ 'aria-label': 'Фильтры заданий' }} summary={<>Фильтры <span className="muted">{hasFilters ? 'Заданы условия' : 'Результат и период'}</span></>}>
        {filterFields}
      </Disclosure>}
    </div>
    <section className="paged-list base-page-stack" aria-busy={tasks.isFetching}>
    <div className="paged-viewport" ref={viewportRef}>
    {!valid ? <Notice role="alert" tone="danger">{validParameters ? 'Начало периода должно быть раньше конца.' : 'Некорректные параметры страницы. Сбросьте фильтры.'}</Notice> : tasks.isPending ? <Loading /> :
      !tasks.data ? <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></> : <>
      {!tasks.isFetchNextPageError && tasks.error && <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></>}
      {tasks.data.items.length === 0 ? <Card><EmptyState headingLevel={2}
          message={status || params.createdFrom || params.createdTo ? 'Ничего не найдено' : 'Заданий пока нет'}
          description={status || params.createdFrom || params.createdTo ? 'Измените условия или сбросьте фильтры, чтобы увидеть задания.' : 'Создайте первое задание. Здесь появятся доставка и результат исполнения.'}
          action={(status || params.createdFrom || params.createdTo) && <Button onClick={() => setSearch({})}>Сбросить фильтры</Button>} /></Card> : mobile ?
          <ul className="task-cards" data-page-items>{tasks.data.items.map(task => <Card asChild key={task.taskId} data-page-item><li className="task-card"><Link className="mobile-card-link" aria-label={task.title} aria-describedby={'task-state-' + task.taskId + ' task-meta-' + task.taskId} title={task.title} to={'/tasks/' + task.taskId} state={returnState}><CardContent density="compact" className="mobile-card-content">
            <div className="mobile-card-heading"><h2 className="base-card-title base-truncate">{task.title}</h2><ChevronRight size={18} aria-hidden="true" /></div>
            <div className="task-card-status" id={'task-state-' + task.taskId}><BusinessBadge status={task.businessStatus} /><span>{deliveryLabels[task.deliveryStatus]}</span></div>
            <div className="mobile-card-meta" id={'task-meta-' + task.taskId}><span className="base-truncate">{task.request.reference} · {task.request.quantity} ед.</span>
              <time dateTime={task.createdAt} title={timestamp(task.createdAt)}>{timestamp(task.createdAt, { showZone: false, compact: true })}</time></div>
          </CardContent></Link></li></Card>)}</ul> :
          <Card><Table className="task-table" data-page-items><caption className="sr-only">Реестр заданий</caption>
            <thead data-page-heading><tr><th scope="col">Название / заявка</th><th scope="col">Доставка</th><th scope="col">Результат</th><th scope="col">Создано (UTC)</th></tr></thead>
            <tbody>{tasks.data.items.slice(0, size).map(task => <tr key={task.taskId} className="base-linked-row" data-page-item><td><Link className="base-truncate" title={task.title} to={'/tasks/' + task.taskId} state={returnState}>{task.title}</Link>
              <small>{task.request.reference} · {task.request.quantity} ед.</small></td><td>{deliveryLabels[task.deliveryStatus]}</td>
              <td><BusinessBadge status={task.businessStatus} /></td><td><time dateTime={task.createdAt}>{timestamp(task.createdAt, { showZone: false })}</time></td></tr>)}</tbody>
          </Table></Card>}
      </>}
    </div>
    {mobile ? valid && tasks.data && <FeedFooter loaded={tasks.data.items.length} total={tasks.data.totalItems} hasNext={tasks.hasNextPage} pending={tasks.isFetching}
      error={tasks.isFetchNextPageError ? tasks.error : null} onLoad={() => tasks.fetchNextPage({ cancelRefetch: false })} /> :
      <Pagination page={validPage ? page : 0} size={size} totalItems={tasks.data?.totalItems} totalPages={tasks.data?.totalPages} pending={tasks.isFetching || !valid} onChange={changePage} />}
    </section>
    <Outlet context={createTrigger} />
  </>;
}

function MobileTaskFilters({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} type="button" className="base-icon-button mobile-filter-trigger" data-active={active || undefined} aria-label="Фильтры заданий" title={active ? 'Фильтры заданий: заданы условия' : 'Фильтры заданий'}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}><SlidersHorizontal size={20} aria-hidden="true" /></Button>
    <Dialog open={open} title="Фильтры заданий" description="Изменения применяются сразу."
      onClose={() => setOpen(false)} returnFocusRef={trigger}>
      <div className="base-dialog-form">
        <div className="base-dialog-body">{children}</div>
        <div className="base-dialog-footer"><Button type="button" variant="default" onClick={() => setOpen(false)}>Готово</Button></div>
      </div>
    </Dialog>
  </>;
}
