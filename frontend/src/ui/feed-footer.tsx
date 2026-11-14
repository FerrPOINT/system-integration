import { useEffect, useRef } from 'react';
import { ErrorMessage } from '../app/error-message';
import { Button } from './button';

export function FeedFooter({
  loaded,
  total,
  hasNext,
  pending,
  error,
  onLoad,
}: {
  loaded: number;
  total: number;
  hasNext: boolean;
  pending: boolean;
  error: Error | null;
  onLoad: () => unknown;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasNext || pending || error || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad();
      },
      { rootMargin: '160px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasNext, pending, error, onLoad]);
  return (
    <div ref={sentinel} className="feed-footer" data-feed-end>
      {error ? (
        <>
          <ErrorMessage error={error} />
          <Button type="button" disabled={pending} onClick={onLoad}>
            Повторить загрузку
          </Button>
        </>
      ) : (
        pending &&
        hasNext && (
          <span role="status" aria-label="Загрузка…">
            Загружаем ещё…
          </span>
        )
      )}
      <small className="muted" role={total === 0 ? 'status' : undefined} aria-live="polite">
        {total === 0 ? 'Нет записей' : `Показано ${loaded} из ${total}`}
      </small>
    </div>
  );
}
