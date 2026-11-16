export function timestamp(
  value: string,
  { showZone = true, compact = false }: { showZone?: boolean; compact?: boolean } = {},
) {
  const format: Intl.DateTimeFormatOptions = compact
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' };
  return new Intl.DateTimeFormat('ru-RU', format).format(new Date(value)) + (showZone ? ' UTC' : '');
}
