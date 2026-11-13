import { ErrorMessage } from '../../app/error-message';
import { BackLink } from '../../ui/back-link';
import { Notice } from '../../ui/notice';
import { Card, CardContent, CardTitle } from '../../ui/card';
import { PageHeader } from '../../ui/page-header';
import { Button } from '../../ui/button';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getTaskReconciliation } from '../../../build/generated/openapi/client';
import { data, keys } from '../../app/api';
import { timestamp } from '../../app/format';
import { Loading } from '../../ui/Feedback';
import { ReconcileButton } from './reconcile-button';
import { Snapshot } from './exchange-snapshot';

const outcomes = { MATCH: 'Состояния совпадают', DIFFERENCE: 'Обнаружено расхождение', UNAVAILABLE: 'Сверка недоступна' };

export function ReconciliationCard() {
  const { taskId = '', reconciliationId = '' } = useParams();
  const snapshot = useQuery({ queryKey: keys.reconciliation(taskId, reconciliationId), staleTime: Infinity,
    queryFn: ({ signal }) => data(getTaskReconciliation(taskId, reconciliationId, { signal })) });
  if (snapshot.isPending) return <Loading />;
  if (!snapshot.data) return <><BackLink to={'/tasks/' + taskId}>К заданию</BackLink><ErrorMessage error={snapshot.error} />
    <Button onClick={() => snapshot.refetch()}>Повторить</Button></>;
  const item = snapshot.data;
  return <>
    <PageHeader back={<BackLink to={'/tasks/' + taskId}>К заданию</BackLink>}
      title="Сохранённая сверка" actions={<ReconcileButton taskId={taskId} />} />
    <ErrorMessage error={snapshot.error} />
    <Card asChild><section className="reconciliation-panel" data-outcome={item.outcome}><CardContent className="base-page-stack"><Notice tone={item.outcome === 'MATCH' ? 'success' : 'danger'} title={<CardTitle asChild><h2>{outcomes[item.outcome]}</h2></CardTitle>}>
      {timestamp(item.checkedAt)} · Оператор {item.checkedBy}</Notice>
      <p className="muted">Это сохранённые данные на момент проверки. Новая сверка создаст отдельную запись.</p>
      <div className="comparison-grid"><Snapshot title="В приложении" value={item.local} />
        {item.external ? <Snapshot title="У исполнителя" value={item.external} /> : <Card asChild><section><CardContent className="base-page-stack"><CardTitle asChild><h3>У исполнителя</h3></CardTitle>
          <p>{item.externalAvailability === 'NOT_FOUND' ? 'Операция с таким ID отсутствует' : 'Не удалось получить корректное состояние'}</p></CardContent></section></Card>}
      </div>
      {item.issueId && <Button asChild variant="default"><Link to={'/issues/' + item.issueId}>Перейти к разбору и решению</Link></Button>}
    </CardContent></section></Card>
  </>;
}
