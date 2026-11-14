import { ErrorMessage } from '../../app/error-message';
import { Notice } from '../../ui/notice';
import { BackLink } from '../../ui/back-link';
import { Timeline, TimelineItem, TimelineMarker, TimelineContent } from '../../ui/timeline';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTask, listTaskHistory, renameTask } from '../../../build/generated/openapi/client';
import type { GetSession200, Task } from '../../../build/generated/openapi/client';
import { ApiError, csrf, data, keys } from '../../app/api';
import { Loading, Pagination, RefreshButton } from '../../ui/Feedback';
import { useCommandKey } from '../../app/use-command-key';
import { deliveryLabels, timestamp } from '../../app/format';
import { ReconcileButton } from '../operations/reconcile-button';
import { taskRefreshInterval } from './refresh-interval';
import { usePagination } from '../../app/use-pagination';
import { BusinessBadge } from './business-badge';

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
  return <>
    <PageHeader className="task-page-header" back={<BackLink to="/tasks">К заданиям</BackLink>} title={item.title}
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
  // Measure the available column, independent of the card's content height.
  return <div className="task-history-viewport" ref={viewportRef}>
    <Card asChild><section className="history-panel" aria-labelledby="task-history-title"><CardContent className="paged-list base-page-stack" aria-busy={history.isFetching}><CardTitle asChild><h2 id="task-history-title">История</h2></CardTitle>
    <div className="paged-viewport">
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
    <Pagination page={valid ? page : 0} size={size} totalItems={history.data?.totalItems} totalPages={history.data?.totalPages} pending={history.isFetching || !valid} onChange={changePage} />
  </CardContent></section></Card></div>;
}
