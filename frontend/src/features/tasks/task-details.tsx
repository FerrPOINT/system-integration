import { ErrorMessage } from '../../shared/ui/error-message';
import { Notice } from '../../shared/ui/notice';
import { BackLink } from '../../shared/ui/back-link';
import { Timeline, TimelineItem, TimelineMarker, TimelineContent } from '../../shared/ui/timeline';
import { ActionGroup } from '../../shared/ui/action-group';
import { Card, CardContent, CardTitle } from '../../shared/ui/card';
import { PageHeader } from '../../shared/ui/page-header';
import { FormField } from '../../shared/ui/form-field';
import { Input } from '../../shared/ui/input';
import { Button } from '../../shared/ui/button';
import { CommandRefresh } from '../../shared/ui/command-refresh';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTask, listTaskHistory, renameTask } from '../../../build/generated/openapi/client';
import type { GetSession200, Task, HistoryEvent } from '../../../build/generated/openapi/client';
import { taskKeys } from './api/task-keys';
import { ApiError, data } from '../../shared/api/http';
import { csrf } from '../../shared/api/csrf';
import { Loading, Pagination, RefreshButton } from '../../shared/ui/feedback';
import { useCommandKey } from '../../shared/lib/forms/use-command-key';
import { deliveryLabels } from './model/task-labels';
import { timestamp } from '../../shared/lib/format/timestamp';
import { ReconcileButton } from '../operations/reconcile-button';
import { taskRefreshInterval } from './refresh-interval';
import { usePagination } from '../../shared/lib/pagination/use-pagination';
import { BusinessBadge } from './business-badge';
import { useMediaQuery } from '../../shared/ui/use-media-query';
import { useCollectionQuery } from '../../shared/lib/collections/use-collection-query';
import { useListReturn } from '../../shared/lib/router/use-list-return';
import { FeedFooter } from '../../shared/ui/feed-footer';
import { DiscardDialog } from '../../shared/ui/dialog';
import { useFormNavigationGuard } from '../../shared/lib/forms/use-form-navigation-guard';

const identifyHistoryEvent = (event: HistoryEvent) => event.eventId;

export function TaskCard({ user }: { user: GetSession200 }) {
  const { id = '' } = useParams();
  // A form session belongs to one task, even when both records are already cached.
  // Revision updates for that same task must preserve its draft and expected revision.
  return <TaskDetails key={id} id={id} user={user} />;
}

function TaskDetails({ id, user }: { id: string; user: GetSession200 }) {
  const returnTo = useListReturn('/tasks');
  const task = useQuery({
    queryKey: taskKeys.task(id),
    queryFn: ({ signal }) => data(getTask(id, { signal })),
    refetchInterval: query => taskRefreshInterval(query.state.data),
  });
  const [editing, setEditing] = useState(false);
  if (task.isPending) return <Loading />;
  if (!task.data) return <><BackLink to={returnTo}>К заданиям</BackLink><ErrorMessage error={task.error} />
    <Button onClick={() => task.refetch()}>Повторить</Button></>;
  const item = task.data;
  return <>
    <PageHeader className="detail-page-header" back={<BackLink to={returnTo}>К заданиям</BackLink>} title={item.title}
      actions={<RefreshButton pending={task.isFetching} onClick={() => task.refetch()} />} />
    <ErrorMessage error={task.error} />
    <div className="task-workspace">
    <Card asChild><section className="task-summary" aria-labelledby="task-state-title"><CardContent className="base-page-stack"><CardTitle asChild><h2 id="task-state-title">Состояние задания</h2></CardTitle>
      <dl className="details"><dt>Доставка</dt><dd>{deliveryLabels[item.deliveryStatus]}</dd>
        <dt>Исполнение</dt><dd><BusinessBadge status={item.businessStatus} /></dd>
        <dt>Заявка</dt><dd>{item.request.reference}</dd><dt>Количество</dt><dd>{item.request.quantity}</dd>
        <dt>Создано</dt><dd><time dateTime={item.createdAt}>{timestamp(item.createdAt, { showZone: false })}</time></dd>
        <dt>ID операции</dt><dd className="technical">{item.operationId}</dd>
        {item.result && <><dt>Завершено</dt><dd>{timestamp(item.result.completedAt)}</dd>
          {item.result.rejectionCode && <><dt>Причина отказа</dt><dd>Количество превышает 100 единиц</dd></>}</>}
      </dl>
      {user.role === 'INITIATOR' && editing ? <RenameForm task={item} onClose={() => setEditing(false)} /> :
        <ActionGroup align="start">
          {user.role === 'INITIATOR' && <Button onClick={() => setEditing(true)}>Изменить название</Button>}
          {user.role === 'OPERATOR' && <ReconcileButton taskId={id} />}
        </ActionGroup>}
    </CardContent></section></Card>
    <History id={id} canReview={user.role === 'OPERATOR'} refreshInterval={taskRefreshInterval(item)} />
    </div>
  </>;
}

function RenameForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const client = useQueryClient();
  const command = useCommandKey();
  const [revision] = useState(task.titleRevision);
  const [dirty, setDirty] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const [initialTitle] = useState(task.title);
  const refresh = useMutation({ mutationFn: () => client.invalidateQueries({ queryKey: taskKeys.tasks }, { throwOnError: true }) });
  const refreshTask = () => refresh.mutate(undefined, { onSuccess: onClose });
  const rename = useMutation({
    mutationFn: async (form: FormData) => {
      const input = { title: String(form.get('title')), expectedTitleRevision: revision };
      return data(renameTask(task.taskId, input, { ...await csrf(), 'Idempotency-Key': command.forInput(input) }));
    },
    onSuccess: () => {
      // A replayed receipt may be older than the task: read current state after every success.
      command.reset(); guard.release(); refreshTask();
    },
  });
  const conflict = rename.error instanceof ApiError && rename.error.status === 409;
  const guard = useFormNavigationGuard({ dirty, pending: rename.isPending });
  return <><form className="base-form edit-form" onSubmit={event => { event.preventDefault(); if (!rename.isPending && !rename.isSuccess) rename.mutate(new FormData(event.currentTarget)); }}>
    <fieldset className="base-form-fieldset base-form" disabled={rename.isPending || rename.isSuccess}>
    <FormField id="field-title" label="Новое название" required>{attrs => <Input {...attrs} ref={titleInput} name="title" maxLength={160} pattern=".*\S.*" defaultValue={initialTitle} autoFocus
      onChange={event => setDirty(event.target.value !== initialTitle)} />}</FormField>
    </fieldset>
    <ErrorMessage error={rename.error} />
    <CommandRefresh message="Название сохранено." error={refresh.error} pending={refresh.isPending} onRetry={refreshTask} />
    <ActionGroup align="start">
      {!rename.isSuccess && <Button variant="default" disabled={rename.isPending || conflict}>Сохранить</Button>}
      <Button type="button" disabled={rename.isPending} onClick={() => guard.requestClose(conflict ? () => { guard.release(); refreshTask(); } : onClose)}>
        {conflict ? 'Обновить карточку' : rename.isSuccess ? 'Закрыть' : 'Отмена'}</Button>
    </ActionGroup>
  </form><DiscardDialog open={guard.open} returnFocusRef={titleInput} onCancel={guard.cancel} onDiscard={guard.discard} /></>;
}

function History({ id, canReview, refreshInterval }: { id: string; canReview: boolean; refreshInterval: number | false }) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const { page, size, valid, viewportRef, changePage } = usePagination(mobile ? 'feed' : 'pages');
  const { query: history, items: historyItems, meta: historyPage } = useCollectionQuery({ key: taskKeys.history(id), page, size, feed: mobile, enabled: valid,
    read: (page, size, signal) => data(listTaskHistory(id, { page, size }, { signal })), identify: identifyHistoryEvent, refreshInterval });
  // Measure the available column, independent of the card's content height.
  return <div className="task-history-viewport" ref={viewportRef}>
    <Card asChild><section className="history-panel" aria-labelledby="task-history-title"><CardContent className="paged-list base-page-stack" aria-busy={history.isFetching}><CardTitle asChild><h2 id="task-history-title">История</h2></CardTitle>
    <div className="paged-viewport">
    {!valid ? <Notice role="alert" tone="danger">Некорректные параметры страницы.</Notice> : history.isPending ? <Loading /> : !historyPage ? <><ErrorMessage error={history.error} />
      <Button onClick={() => history.refetch()}>Повторить</Button></> : <>
      {!history.isFetchNextPageError && <ErrorMessage error={history.error} />}
      <Timeline data-page-items>{historyItems.map(event => <TimelineItem key={event.eventId} data-page-item data-event-id={event.eventId}><TimelineMarker /><TimelineContent>
        <p className="base-truncate" title={event.summary}>{event.summary}</p><small title={event.actorUserId}><time dateTime={event.occurredAt} title={timestamp(event.occurredAt)}>{timestamp(event.occurredAt, { compact: mobile, showZone: !mobile })}</time> ·
          {event.actor === 'SYSTEM' ? ' Система' : ` Пользователь ${mobile ? event.actorUserId?.slice(0, 8) : event.actorUserId}`}</small>
        {canReview && event.reconciliationId && <Link to={'/tasks/' + id + '/reconciliations/' + event.reconciliationId}>Открыть сохранённую сверку</Link>}
        {canReview && event.issueId && <Link to={'/issues/' + event.issueId}>Открыть разбор</Link>}
      </TimelineContent></TimelineItem>)}</Timeline>
    </>}
    </div>
    {mobile ? valid && historyPage && <FeedFooter loaded={historyItems.length} total={historyPage.totalItems} hasNext={history.hasNextPage} pending={history.isFetching}
      error={history.isFetchNextPageError ? history.error : null} onLoad={() => history.fetchNextPage({ cancelRefetch: false })} /> :
      <Pagination page={valid ? page : 0} size={size} totalItems={historyPage?.totalItems} totalPages={historyPage?.totalPages} pending={history.isFetching || !valid} onChange={changePage} />}
  </CardContent></section></Card></div>;
}
