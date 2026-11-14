import { useEffect, useRef } from 'react';
import { ErrorMessage } from './error-message';
import { Button } from './button';

function useVisibleLoad({ more, busy, error, autoLoad, onLoad }: {
  more: boolean; busy: boolean; error: Error | null; autoLoad: boolean; onLoad: () => unknown;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more || busy || error || !autoLoad || !sentinel.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active && entries.some(entry => entry.isIntersecting)) onLoad();
    }, { rootMargin: '160px 0px' });
    observer.observe(sentinel.current);
    return () => { active = false; observer.disconnect(); };
  }, [more, busy, error, autoLoad, onLoad]);
  return sentinel;
}

export function FeedStart({ hasPrevious, pending, busy, error, autoLoad, onLoad }: {
  hasPrevious: boolean; pending: boolean; busy: boolean; error: Error | null; autoLoad: boolean; onLoad: () => unknown;
}) {
  const sentinel = useVisibleLoad({ more: hasPrevious, busy, error, autoLoad, onLoad });
  return <div ref={sentinel} className="feed-start" data-feed-start>
    {error ? <><ErrorMessage error={error} /><Button type="button" disabled={busy} onClick={onLoad}>Повторить загрузку предыдущих записей</Button></> :
      pending && <span role="status" aria-label="Загрузка…">Загрузка…</span>}
  </div>;
}

export function FeedFooter({ loaded, total, start, end, hasNext, pending, busy, error, autoLoad, notice, onLoad }: {
  loaded: number; total: number; start: number; end: number; hasNext: boolean; pending: boolean; busy: boolean;
  error: Error | null; autoLoad: boolean; notice?: string; onLoad: () => unknown;
}) {
  const sentinel = useVisibleLoad({ more: hasNext, busy, error, autoLoad, onLoad });
  return <div ref={sentinel} className="feed-footer" data-feed-end>
    {error ? <><ErrorMessage error={error} /><Button type="button" disabled={busy} onClick={onLoad}>Повторить загрузку</Button></> :
      pending && hasNext && !notice && <span role="status" aria-label="Загрузка…">Загрузка…</span>}
    {notice && <small className="muted" role="status">{notice}</small>}
    <small className="muted" role={total === 0 ? 'status' : undefined} aria-live="polite">{total === 0 ? 'Нет записей' : loaded ? `${start}–${end} из ${total}` : `Всего: ${total}`}</small>
  </div>;
}
