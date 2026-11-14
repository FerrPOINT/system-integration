import { BusinessStatus } from '../../../../build/generated/openapi/client.ts';
import type { ListTasksParams } from '../../../../build/generated/openapi/client';

export type TaskFilters = Pick<ListTasksParams, 'businessStatus' | 'createdFrom' | 'createdTo'>;

export function parseTaskSearch(search: URLSearchParams) {
  const status = search.get('businessStatus') || undefined;
  const rawFrom = search.get('createdFrom') || undefined;
  const rawTo = search.get('createdTo') || undefined;
  const from = utcFilter(rawFrom);
  const to = utcFilter(rawTo);
  const params: TaskFilters = {
    businessStatus: status as BusinessStatus | undefined,
    createdFrom: from?.wire,
    createdTo: to?.wire,
  };
  const validParameters =
    (!status || Object.hasOwn(BusinessStatus, status)) && (!rawFrom || Boolean(from)) && (!rawTo || Boolean(to));
  const validPeriod = !from || !to || from.order < to.order;
  return {
    status,
    params,
    validParameters,
    validPeriod,
    hasFilters: Boolean(status || rawFrom || rawTo),
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

/** URL dates are normalized once for both the request and the minute-resolution UTC editor. */
function utcFilter(value: string | undefined) {
  const match = value?.match(
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([0-9]{2}:[0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?([Zz]|[+-][0-9]{2}:[0-9]{2})$/,
  );
  if (!match || match[1].startsWith('0000')) return undefined;
  const calendar = match[1] + 'T' + match[2] + ':' + (match[3] ?? '00');
  const local = Date.parse(calendar + 'Z');
  // Date.parse silently carries impossible dates into the next month; reject that normalization.
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== calendar) return undefined;
  const zone = match[5];
  let offset = 0;
  if (zone.toUpperCase() !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 23 || minutes > 59 || zone === '-00:00') return undefined;
    offset = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  }
  const utc = new Date(local - offset * 60_000).toISOString();
  if (!/^[0-9]{4}-/.test(utc) || utc.startsWith('0000')) return undefined;
  const seconds = utc.slice(0, 19);
  const fraction = (match[4] ?? '').replace(/0+$/, '');
  return {
    wire: seconds + (fraction ? '.' + fraction : '') + 'Z',
    // Fixed-width UTC strings preserve nanosecond ordering without Date's millisecond truncation.
    order: seconds + '.' + fraction.padEnd(9, '0') + 'Z',
  };
}

/** datetime-local is explicitly a UTC editor, regardless of the browser's timezone. */
export function utcFilterValue(value: string | undefined) {
  return utcFilter(value)?.wire.slice(0, 16) ?? '';
}
