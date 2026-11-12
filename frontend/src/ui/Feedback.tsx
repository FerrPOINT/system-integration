import { PageNavigation } from './page-navigation';
import { useMediaQuery } from './use-media-query';
import { Notice } from './notice';
import { ApiError } from '../app/api';

export function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Notice tone="danger" role="alert">{error instanceof ApiError ? error.message : 'Не удалось выполнить запрос. Повторите попытку.'}</Notice>;
}

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
  return <PageNavigation page={page + 1} pageCount={totalPages} compact={compact} pending={pending}
    onPageChange={next => onChange(next - 1)} summary={summary} />;
}
