import { Notice } from './notice';
import { ActionGroup } from './action-group';
import { Button } from './button';
import { ApiError } from '../app/api';

export function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Notice tone="danger" role="alert">{error instanceof ApiError ? error.message : 'Не удалось выполнить запрос. Повторите попытку.'}</Notice>;
}

export function Loading() {
  return <div className="base-loading-state" role="status" aria-label="Загрузка…" aria-busy="true" data-scope="page">Загрузка…</div>;
}

export function Pagination({ page, hasNext, pending, onChange }: {
  page: number; hasNext: boolean; pending: boolean; onChange: (page: number) => void;
}) {
  return <ActionGroup asChild align="end"><nav className="pagination" aria-label="Страницы">
    <Button type="button" disabled={page === 0 || pending} onClick={() => onChange(page - 1)}>← Назад</Button>
    <span aria-live="polite">Страница {page + 1}</span>
    <Button type="button" disabled={!hasNext || pending} onClick={() => onChange(page + 1)}>Далее →</Button>
  </nav></ActionGroup>;
}
