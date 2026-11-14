import { Card, CardContent, CardTitle } from '../../ui/card';
import type { LocalSnapshot, OperationState } from '../../../build/generated/openapi/client';
import { businessLabels, deliveryLabels, timestamp } from '../../app/format';

export function Snapshot({ title, value }: { title: string; value: LocalSnapshot | OperationState }) {
  const external = 'executions' in value;
  const status = external ? value.result?.status || 'PENDING' : value.businessStatus;
  return (
    <Card asChild>
      <section className="snapshot">
        <CardContent className="base-page-stack">
          <CardTitle asChild>
            <h3>{title}</h3>
          </CardTitle>
          <dl>
            <dt>Заявка</dt>
            <dd>{value.request.reference}</dd>
            <dt>Количество</dt>
            <dd>{value.request.quantity}</dd>
            {!external && (
              <>
                <dt>Доставка</dt>
                <dd>{deliveryLabels[value.deliveryStatus]}</dd>
              </>
            )}
            <dt>Исполнение</dt>
            <dd>{businessLabels[status]}</dd>
            {external && (
              <>
                <dt>ID операции</dt>
                <dd className="technical">{value.operationId}</dd>
                <dt>Исполнений</dt>
                <dd>{value.executions}</dd>
              </>
            )}
            {value.result?.completedAt && (
              <>
                <dt>Завершено</dt>
                <dd>{timestamp(value.result.completedAt)}</dd>
              </>
            )}
            {value.result?.rejectionCode && (
              <>
                <dt>Причина отказа</dt>
                <dd>Количество превышает 100 единиц</dd>
              </>
            )}
          </dl>
        </CardContent>
      </section>
    </Card>
  );
}
