import { Fragment, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ActionGroup } from './action-group';
import { Button } from './button';

// Base PageNavigation: counted pages, with a bounded number window.
export function PageNavigation({ page, pageCount, onPageChange, pending, compact, summary }: {
  page: number; pageCount: number; onPageChange: (page: number) => void;
  pending?: boolean; compact?: boolean; summary: ReactNode;
}) {
  const current = page <= pageCount ? page : 1;
  const pages = compact
    ? pageCount > 0 ? [current] : []
    : [...new Set([1, current - 1, current, current + 1, pageCount])].filter(n => n > 0 && n <= pageCount).sort((a, b) => a - b);
  if (pageCount <= 1 && page <= 1) return <div className="base-page-summary" role="status">{summary}</div>;
  return <ActionGroup asChild><nav className="base-page-navigation" aria-label="Страницы">
    <span className="base-page-summary" aria-live="polite">{summary}</span>
    <Button type="button" className="base-icon-button" disabled={pending || page <= 1} aria-label="← Назад" title="Предыдущая страница" onClick={() => onPageChange(page - 1)}>
      <ChevronLeft size={18} aria-hidden="true" />
    </Button>
    {pages.map((number, i) => <Fragment key={number}>
      {i > 0 && number - pages[i - 1] > 1 && <span aria-hidden="true">…</span>}
      <Button type="button" variant={number === page ? 'default' : 'outline'} aria-label={'Страница ' + number}
        aria-current={number === page ? 'page' : undefined} disabled={pending}
        onClick={() => onPageChange(number)}>{number}</Button>
    </Fragment>)}
    <Button type="button" className="base-icon-button" disabled={pending || page >= pageCount} aria-label="Далее →" title="Следующая страница" onClick={() => onPageChange(page + 1)}>
      <ChevronRight size={18} aria-hidden="true" />
    </Button>
    {pageCount === 0 && page > 1 && <Button type="button" onClick={() => onPageChange(1)}>В начало</Button>}
  </nav></ActionGroup>;
}
