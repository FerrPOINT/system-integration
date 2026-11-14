import { RefreshCw } from 'lucide-react';
import { Button } from './button';
import { PageNavigation } from './page-navigation';
import { useMediaQuery } from './use-media-query';
export function Loading() {
  return <div className="base-loading-state" role="status" aria-label="Загрузка…" aria-busy="true" data-scope="page">Загрузка…</div>;
}

export function Pagination({ page, size, totalPages, totalItems, pending, onChange }: {
  page: number; size: number; totalPages?: number; totalItems?: number; pending: boolean; onChange: (page: number) => void;
}) {
  const compact = useMediaQuery('(max-width: 760px)');
  if (totalItems === undefined || totalPages === undefined) return <div className="pagination-footer" aria-hidden="true" />;
  const summary = totalPages === 0 ? 'Нет записей'
    : page < totalPages ? totalPages === 1 ? 'Всего: ' + totalItems
      : (page * size + 1) + '–' + Math.min((page + 1) * size, totalItems) + ' из ' + totalItems
    : 'Страница не найдена';
  return <div className="pagination-footer"><PageNavigation page={page + 1} pageCount={totalPages} compact={compact} pending={pending}
    onPageChange={next => onChange(next - 1)} summary={summary} /></div>;
}

export function RefreshButton({ pending, disabled, onClick }: {
  pending: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <Button type="button" className="base-icon-button" aria-label="Обновить"
    title={pending ? 'Обновляем…' : 'Обновить'} aria-busy={pending} disabled={pending || disabled} onClick={onClick}>
    <RefreshCw size={20} aria-hidden="true" />
  </Button>;
}
