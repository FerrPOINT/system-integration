import type { CollectionPage } from './project-collection';
import type { FeedPosition } from './feed-position-storage';

const rows = (viewport: HTMLElement) => Array.from(viewport.querySelectorAll<HTMLElement>('[data-record-id]'));

export function capturePosition<T>(viewport: HTMLElement | null, pages: CollectionPage<T>[] | undefined, identify: (item: T) => string): FeedPosition | undefined {
  if (!viewport || !pages?.length) return;
  const row = rows(viewport).find(row => { const box = row.getBoundingClientRect(); return box.bottom > 0 && box.top < window.innerHeight; });
  if (!row) return { page: pages[0].page, index: 0, offset: 0, scrollY: window.scrollY };
  const id = row.dataset.recordId;
  for (const page of pages) {
    const index = page.items.findIndex(item => identify(item) === id);
    if (index >= 0) return { page: page.page, index, id, offset: row.getBoundingClientRect().top, scrollY: window.scrollY };
  }
}

export function alignPosition(viewport: HTMLElement, position: FeedPosition): 'restored' | 'missing' | 'insufficient' {
  if (!position.id) { window.scrollTo(0, position.scrollY); return 'restored'; }
  const row = rows(viewport).find(row => row.dataset.recordId === position.id);
  if (!row) return 'missing';
  const top = window.scrollY + row.getBoundingClientRect().top - position.offset;
  if (top > document.documentElement.scrollHeight - window.innerHeight + 1) return 'insufficient';
  window.scrollTo(0, Math.max(0, top));
  return 'restored';
}

export function nearestPosition<T>(position: FeedPosition, pages: CollectionPage<T>[], identify: (item: T) => string): FeedPosition {
  const page = pages.find(page => page.page === position.page) ?? pages[0];
  const index = Math.min(position.index, page.items.length - 1);
  return { ...position, page: page.page, index: Math.max(0, index), id: index >= 0 ? identify(page.items[index]) : undefined };
}
