import type { IssueKind } from '../../../build/generated/openapi/client';

export const issueKindLabels: Record<IssueKind, string> = {
  DELIVERY_UNCERTAIN: 'Доставка не подтверждена', DELIVERY_DELAYED: 'Лимит попыток исчерпан', PROTOCOL_ERROR: 'Ошибка протокола',
  RESULT_CONFLICT: 'Конфликт результата', RECONCILIATION_DIFFERENCE: 'Расхождение при сверке',
};
