import type { BusinessStatus, DeliveryStatus, TaskResultRejectionCode } from '../../../../build/generated/openapi/client';

export const businessLabels: Record<BusinessStatus, string> = {
  PENDING: 'Ожидает исполнения', RUNNING: 'Исполняется', SUCCEEDED: 'Выполнено', REJECTED: 'Отклонено',
};
export const deliveryLabels: Record<DeliveryStatus, string> = {
  QUEUED: 'В очереди', RETRY_WAIT: 'Ожидает отправки', UNKNOWN: 'Доставка не подтверждена',
  ACKNOWLEDGED: 'Получено исполнителем', NEEDS_REVIEW: 'Нужен разбор', STOPPED: 'Отправка остановлена',
};
export const rejectionLabels: Record<TaskResultRejectionCode, string> = {
  QUANTITY_LIMIT_EXCEEDED: 'Количество превышает 100 единиц',
};
