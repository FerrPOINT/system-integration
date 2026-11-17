import type { CollectionPage } from './project-collection';
import type { FeedPosition } from './feed-position-storage';

const rows = (viewport: HTMLElement) => Array.from(viewport.querySelectorAll<HTMLElement>('[data-record-id]'));

function scrollMetrics(root?: HTMLElement | null) {
  return root
    ? {
        top: root.getBoundingClientRect().top + root.clientTop,
        height: root.clientHeight,
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
      }
    : {
        top: 0,
        height: window.innerHeight,
        scrollTop: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      };
}

export function capturePosition<T>(
  viewport: HTMLElement | null,
  pages: CollectionPage<T>[] | undefined,
  identify: (item: T) => string,
  scrollRoot?: HTMLElement | null,
): FeedPosition | undefined {
  if (!viewport || !pages?.length) return;
  const { top, height, scrollTop } = scrollMetrics(scrollRoot);
  const row = rows(viewport).find((row) => {
    const box = row.getBoundingClientRect();
    return box.bottom > top && box.top < top + height;
  });
  if (!row) return { page: pages[0].page, index: 0, offset: 0, scrollY: scrollTop };
  const id = row.dataset.recordId;
  for (const page of pages) {
    const index = page.items.findIndex((item) => identify(item) === id);
    if (index >= 0)
      return { page: page.page, index, id, offset: row.getBoundingClientRect().top - top, scrollY: scrollTop };
  }
}

export function alignPosition(
  viewport: HTMLElement,
  position: FeedPosition,
  scrollRoot?: HTMLElement | null,
): 'restored' | 'missing' | 'insufficient' {
  const scroller = scrollRoot ?? window;
  if (!position.id) {
    scroller.scrollTo(0, position.scrollY);
    return 'restored';
  }
  const row = rows(viewport).find((row) => row.dataset.recordId === position.id);
  if (!row) return 'missing';
  const { top, height, scrollTop, scrollHeight } = scrollMetrics(scrollRoot);
  const target = scrollTop + row.getBoundingClientRect().top - top - position.offset;
  if (target > scrollHeight - height + 1) return 'insufficient';
  scroller.scrollTo(0, Math.max(0, target));
  return 'restored';
}

export function nearestPosition<T>(
  position: FeedPosition,
  pages: CollectionPage<T>[],
  identify: (item: T) => string,
): FeedPosition {
  const page = pages.find((page) => page.page === position.page) ?? pages[0];
  const index = Math.min(position.index, page.items.length - 1);
  return {
    ...position,
    page: page.page,
    index: Math.max(0, index),
    id: index >= 0 ? identify(page.items[index]) : undefined,
  };
}
