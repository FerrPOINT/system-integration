/** A list keeps its position across visits; pagination already belongs to the query key. */
export function listPositionScope({ pathname, search }: { pathname: string; search: string }) {
  const parameters = new URLSearchParams(search);
  parameters.delete('page');
  parameters.delete('size');
  return pathname + (parameters.size ? '?' + parameters.toString() : '');
}
