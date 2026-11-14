import './tasks.css';
import { ErrorMessage } from '../../../shared/ui/error-message';
import { BackLink } from '../../../shared/ui/back-link';
import { ActionGroup } from '../../../shared/ui/action-group';
import { Card, CardContent, CardTitle } from '../../../shared/ui/card';
import { PageHeader } from '../../../shared/ui/page-header';
import { Button } from '../../../shared/ui/button';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { GetSession200 } from '../../../../build/generated/openapi/client';
import { Loading, RefreshButton } from '../../../shared/ui/feedback';
import { deliveryLabels, rejectionLabels } from '../model/task-labels';
import { timestamp } from '../../../shared/lib/format/timestamp';
import { ReconcileButton } from '../../operations/reconciliation';
import { taskRefreshInterval } from '../model/refresh-interval';
import { BusinessBadge } from './task-presenters';
import { useListReturn } from '../../../shared/lib/router/use-list-return';
import { taskOptions } from '../api/task-queries';

import { RenameForm } from './task-rename-form';
import { History } from './task-history';

export function TaskCard({ user }: { user: GetSession200 }) {
  const { id = '' } = useParams();
  // A form session belongs to one task, even when both records are already cached.
  // Revision updates for that same task must preserve its draft and expected revision.
  return <TaskDetails key={id} id={id} user={user} />;
}

function TaskDetails({ id, user }: { id: string; user: GetSession200 }) {
  const returnTo = useListReturn('/tasks');
  const task = useQuery(taskOptions(id));
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
          {item.result.rejectionCode && <><dt>Причина отказа</dt><dd>{rejectionLabels[item.result.rejectionCode]}</dd></>}</>}
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
