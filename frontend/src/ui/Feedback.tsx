import { RefreshCw } from 'lucide-react';
import { Button } from './button';
import { PageNavigation } from './page-navigation';
import { useMediaQuery } from './use-media-query';
export function Loading() {
  return <div className="base-loading-state" role="status" aria-label="Загрузка…" aria-busy="true" data-scope="page">Загрузка…</div>;
}

export function Pagination({ page, totalPages, totalItems, pending, onChange }: {
  page: number; totalPages: number; totalItems: number; pending: boolean; onChange: (page: number) => void;
}) {
  const compact = useMediaQuery('(max-width: 760px)');
  const summary = totalPages === 0 ? 'Нет записей'
    : page < totalPages ? 'Страница ' + (page + 1) + ' из ' + totalPages + ' · Всего записей: ' + totalItems
    : 'Страница ' + (page + 1) + ' не найдена · Всего страниц: ' + totalPages;
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
