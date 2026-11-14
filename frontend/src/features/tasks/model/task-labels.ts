import type {
  BusinessStatus,
  DeliveryStatus,
  TaskResultRejectionCode,
  HistoryEventType,
} from '../../../../build/generated/openapi/client';

/** Protocol details remain verbatim inside a disclosure, apart from the readable event title. */
export const technicalHistoryLabels: Partial<Record<HistoryEventType, string>> = {
  DELIVERY_ATTEMPT: 'Попытка доставки',
  DELIVERY_UNCERTAIN: 'Доставка требует уточнения',
  DELIVERY_ACKNOWLEDGED: 'Исполнитель подтвердил получение',
  RESULT_APPLIED: 'Получен результат исполнителя',
  RESULT_IGNORED: 'Сохранено наблюдение об исполнении',
  RECONCILED: 'Выполнена сверка с исполнителем',
};

export const businessLabels: Record<BusinessStatus, string> = {
  PENDING: 'Ожидает исполнения',
  RUNNING: 'Исполняется',
  SUCCEEDED: 'Выполнено',
  REJECTED: 'Отклонено',
};
export const deliveryLabels: Record<DeliveryStatus, string> = {
  QUEUED: 'В очереди',
  RETRY_WAIT: 'Ожидает отправки',
  UNKNOWN: 'Доставка не подтверждена',
  ACKNOWLEDGED: 'Получено исполнителем',
  NEEDS_REVIEW: 'Нужен разбор',
  STOPPED: 'Отправка остановлена',
};
export const rejectionLabels: Record<TaskResultRejectionCode, string> = {
  QUANTITY_LIMIT_EXCEEDED: 'Количество превышает 100 единиц',
};
