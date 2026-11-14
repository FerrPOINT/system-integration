import { Table } from '../../../shared/ui/table';
import { Card, CardContent } from '../../../shared/ui/card';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { businessLabels, deliveryLabels } from '../model/task-labels';
import { timestamp } from '../../../shared/lib/format/timestamp';
import { Badge } from '../../../shared/ui/badge';
import type { BusinessStatus } from '../../../../build/generated/openapi/client';

import type { Task } from '../../../../build/generated/openapi/client';

export function TaskRecords({
  items,
  size,
  mobile,
  returnState,
}: {
  items: Task[];
  size: number;
  mobile: boolean;
  returnState: { returnTo: string };
}) {
  return (
    <>
      {mobile ? (
        <ul className="task-cards" data-page-items>
          {items.map((task) => (
            <Card asChild key={task.taskId} data-page-item>
              <li className="task-card" data-record-id={task.taskId}>
                <Link
                  className="mobile-card-link"
                  aria-label={task.title}
                  aria-describedby={'task-state-' + task.taskId + ' task-meta-' + task.taskId}
                  title={task.title}
                  to={'/tasks/' + task.taskId}
                  state={returnState}
                >
                  <CardContent density="compact" className="mobile-card-content">
                    <div className="mobile-card-heading">
                      <h2 className="base-card-title base-truncate">{task.title}</h2>
                      <ChevronRight size={18} aria-hidden="true" />
                    </div>
                    <div className="task-card-status" id={'task-state-' + task.taskId}>
                      <BusinessBadge status={task.businessStatus} />
                      <span>{deliveryLabels[task.deliveryStatus]}</span>
                    </div>
                    <div className="mobile-card-meta" id={'task-meta-' + task.taskId}>
                      <span className="base-truncate">
                        {task.request.reference} · {task.request.quantity} ед.
                      </span>
                      <time dateTime={task.createdAt} title={timestamp(task.createdAt)}>
                        {timestamp(task.createdAt, { showZone: false, compact: true })}
                      </time>
                    </div>
                  </CardContent>
                </Link>
              </li>
            </Card>
          ))}
        </ul>
      ) : (
        <Card>
          <Table className="task-table" data-page-items>
            <caption className="sr-only">Реестр заданий</caption>
            <thead data-page-heading>
              <tr>
                <th scope="col">Название / заявка</th>
                <th scope="col">Доставка</th>
                <th scope="col">Результат</th>
                <th scope="col">Создано (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, size).map((task) => (
                <tr key={task.taskId} className="base-linked-row" data-page-item data-record-id={task.taskId}>
                  <td>
                    <Link className="base-truncate" title={task.title} to={'/tasks/' + task.taskId} state={returnState}>
                      {task.title}
                    </Link>
                    <small>
                      {task.request.reference} · {task.request.quantity} ед.
                    </small>
                  </td>
                  <td>{deliveryLabels[task.deliveryStatus]}</td>
                  <td>
                    <BusinessBadge status={task.businessStatus} />
                  </td>
                  <td>
                    <time dateTime={task.createdAt}>{timestamp(task.createdAt, { showZone: false })}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

export function BusinessBadge({ status }: { status: BusinessStatus }) {
  return (
    <Badge
      tone={
        status === 'SUCCEEDED'
          ? 'success'
          : status === 'REJECTED'
            ? 'danger'
            : status === 'RUNNING'
              ? 'info'
              : 'neutral'
      }
    >
      {businessLabels[status]}
    </Badge>
  );
}
