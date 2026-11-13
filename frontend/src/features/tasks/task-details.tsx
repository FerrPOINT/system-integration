import { ErrorMessage } from '../../app/error-message';
import { BackLink } from '../../ui/back-link';
import { Timeline, TimelineItem, TimelineMarker, TimelineContent } from '../../ui/timeline';
import { ActionGroup } from '../../ui/action-group';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { FormField } from '../../ui/form-field';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTask, listTaskHistory, renameTask } from '../../../build/generated/openapi/client';
import type { GetSession200, Task } from '../../../build/generated/openapi/client';
import { ApiError, csrf, data, keys } from '../../app/api';
import { Loading, Pagination } from '../../ui/Feedback';
import { useCommandKey } from '../../app/use-command-key';
import { deliveryLabels, timestamp } from '../../app/format';
import { taskRefreshInterval } from './refresh-interval';
import { BusinessBadge } from './business-badge';
import { ReconcileButton } from '../operations/reconcile-button';

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
  const [page, setPage] = useState(0);
  const history = useQuery({ queryKey: keys.history(id, page),
    queryFn: ({ signal }) => data(listTaskHistory(id, { page }, { signal })), refetchInterval: refreshInterval });
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
