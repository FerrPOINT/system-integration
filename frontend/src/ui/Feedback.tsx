export function ErrorMessage({ error }: { error: Error | null }) {
  if (!error) return null;
  return <p className="message error" role="alert">{error.message}</p>;
}

export function Loading() {
  return <p className="message" role="status">Загрузка…</p>;
}

export function Pagination({ page, hasNext, pending, onChange }: {
  page: number; hasNext: boolean; pending: boolean; onChange: (page: number) => void;
}) {
  return <nav className="pagination" aria-label="Страницы">
    <button type="button" disabled={page === 0 || pending} onClick={() => onChange(page - 1)}>← Назад</button>
    <span aria-live="polite">Страница {page + 1}</span>
    <button type="button" disabled={!hasNext || pending} onClick={() => onChange(page + 1)}>Далее →</button>
  </nav>;
}
