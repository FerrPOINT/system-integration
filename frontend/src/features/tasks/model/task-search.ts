import { BusinessStatus } from '../../../../build/generated/openapi/client.ts';
import type { ListTasksParams } from '../../../../build/generated/openapi/client';

export type TaskFilters = Pick<ListTasksParams, 'businessStatus' | 'createdFrom' | 'createdTo'>;

export function parseTaskSearch(search: URLSearchParams) {
  const status = search.get('businessStatus') || undefined;
  const params: TaskFilters = {
    businessStatus: status as BusinessStatus | undefined,
    createdFrom: search.get('createdFrom') || undefined,
    createdTo: search.get('createdTo') || undefined,
  };
  const validParameters =
    (!status || Object.hasOwn(BusinessStatus, status)) &&
    [params.createdFrom, params.createdTo].every((value) => !value || Number.isFinite(Date.parse(value)));
  const validPeriod =
    !params.createdFrom || !params.createdTo || Date.parse(params.createdFrom) < Date.parse(params.createdTo);
  return {
    status,
    params,
    validParameters,
    validPeriod,
    hasFilters: Boolean(status || params.createdFrom || params.createdTo),
  };
}

export function changeTaskFilters(search: URLSearchParams, changes: Record<string, string | undefined>) {
  const updated = new URLSearchParams(search);
  updated.delete('page');
  for (const [key, value] of Object.entries(changes)) {
    if (value) updated.set(key, value);
    else updated.delete(key);
  }
  return updated;
}

/** datetime-local is explicitly a UTC editor, regardless of the browser's timezone. */
export function utcFilterValue(value: string | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 16) : '';
}
