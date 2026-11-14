import './tasks.css';
import { useTaskList } from '../model/use-task-list';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { Notice } from '../../../shared/ui/notice';
import { Disclosure } from '../../../shared/ui/disclosure';
import { EmptyState } from '../../../shared/ui/empty-state';
import { Card } from '../../../shared/ui/card';
import { PageHeader } from '../../../shared/ui/page-header';
import { Button } from '../../../shared/ui/button';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import type { GetSession200 } from '../../../../build/generated/openapi/client';
import { Loading, Pagination, RefreshButton } from '../../../shared/ui/feedback';
import { useMediaQuery } from '../../../shared/ui/use-media-query';
import { FeedFooter } from '../../../shared/ui/feed-footer';

import { TaskFilterFields, MobileTaskFilters } from './task-filters';
import { TaskRecords } from './task-presenters';
import type { TaskRouteContext } from './task-route-context';

export function TaskList({ user }: { user: GetSession200 }) {
  const createTrigger = useRef<HTMLAnchorElement>(null);
  const mobile = useMediaQuery('(max-width: 760px)');
  const location = useLocation();
  const returnState = { returnTo: location.pathname + location.search };
  const { search, pagination, filters, validParameters, valid, collection, changeFilters, resetFilters } = useTaskList(mobile);
  const { page, size, valid: validPage, viewportRef, changePage } = pagination;
  const { status, params, validPeriod, hasFilters } = filters;
  const { query: tasks, items: tasksItems, meta: tasksPage } = collection;
  const [filtersOpen, setFiltersOpen] = useState(true);
  const filterFields = <TaskFilterFields params={params} status={status} mobile={mobile} validPeriod={validPeriod}
    changeFilters={changeFilters} resetFilters={() => resetFilters()} />;
  return <>
    <div className="list-tools base-page-stack"><PageHeader title={user.role === 'OPERATOR' ? 'Все задания' : 'Мои задания'}
      context={mobile ? tasksPage && `Всего: ${tasksPage.totalItems}` : 'Приём задания, доставка и результат исполнения показаны отдельно.'}
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
      !tasksPage ? <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></> : <>
      {!tasks.isFetchNextPageError && tasks.error && <><ErrorMessage error={tasks.error} /><Button onClick={() => tasks.refetch()}>Повторить</Button></>}
      {tasksItems.length === 0 ? <Card><EmptyState headingLevel={2}
          message={status || params.createdFrom || params.createdTo ? 'Ничего не найдено' : 'Заданий пока нет'}
          description={status || params.createdFrom || params.createdTo ? 'Измените условия или сбросьте фильтры, чтобы увидеть задания.' : 'Создайте первое задание. Здесь появятся доставка и результат исполнения.'}
          action={(status || params.createdFrom || params.createdTo) && <Button onClick={() => resetFilters(false)}>Сбросить фильтры</Button>} /></Card> : <TaskRecords items={tasksItems} size={size} mobile={mobile} returnState={returnState} />}
      </>}
    </div>
    {mobile ? valid && tasksPage && <FeedFooter loaded={tasksItems.length} total={tasksPage.totalItems} hasNext={tasks.hasNextPage} pending={tasks.isFetching}
      error={tasks.isFetchNextPageError ? tasks.error : null} onLoad={() => tasks.fetchNextPage({ cancelRefetch: false })} /> :
      <Pagination page={validPage ? page : 0} size={size} totalItems={tasksPage?.totalItems} totalPages={tasksPage?.totalPages} pending={tasks.isFetching || !valid} onChange={changePage} />}
    </section>
    <Outlet context={{ user, createTrigger } satisfies TaskRouteContext} />
  </>;
}
