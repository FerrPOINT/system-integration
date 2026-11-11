import type { BusinessStatus, DeliveryStatus } from '../../build/generated/openapi/client';

export const businessLabels: Record<BusinessStatus, string> = {
  PENDING: 'Ожидает исполнения', RUNNING: 'Исполняется', SUCCEEDED: 'Выполнено', REJECTED: 'Отклонено',
};
export const deliveryLabels: Record<DeliveryStatus, string> = {
  QUEUED: 'В очереди', RETRY_WAIT: 'Ожидает отправки', UNKNOWN: 'Доставка не подтверждена',
  ACKNOWLEDGED: 'Получено исполнителем', NEEDS_REVIEW: 'Нужен разбор', STOPPED: 'Отправка остановлена',
};
export function timestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
