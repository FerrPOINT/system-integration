import { useLayoutEffect, useRef, useState } from 'react';

export function fitPageSize(height: number, rowHeight: number, gap: number, columns: number) {
  return Math.min(100, Math.max(1, Math.floor((height + gap) / (rowHeight + gap))) * columns);
}

/** Use rendered dimensions and retain the tallest row at this width to prevent oscillation. */
export function usePageSize(page: number) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const metrics = useRef({ width: 0, rowHeight: 0 });
  useLayoutEffect(() => {
    if (!viewport) return;
    metrics.current = { width: 0, rowHeight: 0 };
    let frame = 0;
    function measure() {
      const list = viewport!.querySelector<HTMLElement>('[data-page-items]');
      const items = list?.querySelectorAll<HTMLElement>('[data-page-item]');
      if (!list || !items?.length || viewport!.clientHeight === 0) return;
      const width = viewport!.clientWidth;
      const tallest = Math.max(...Array.from(items, item => item.getBoundingClientRect().height));
      if (!tallest) return;
      const rowHeight = metrics.current.width === width ? Math.max(metrics.current.rowHeight, tallest) : tallest;
      metrics.current = { width, rowHeight };
      const style = getComputedStyle(list);
      const gap = parseFloat(style.rowGap) || 0;
      const columns = style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 1;
      const listBox = list.getBoundingClientRect();
      const inset = Math.max(0, listBox.top - viewport!.getBoundingClientRect().top + viewport!.scrollTop)
        + Math.max(0, viewport!.lastElementChild!.getBoundingClientRect().bottom - listBox.bottom);
      const heading = list.querySelector<HTMLElement>('[data-page-heading]')?.getBoundingClientRect().height || 0;
      setSize(fitPageSize(viewport!.clientHeight - inset - heading, rowHeight, gap, columns));
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
    const resize = new ResizeObserver(schedule);
    function observe() {
      resize.disconnect(); resize.observe(viewport!);
      viewport!.querySelectorAll('[data-page-items], [data-page-item], [data-page-heading]').forEach(item => resize.observe(item));
      schedule();
    }
    const changes = new MutationObserver(observe);
    changes.observe(viewport, { childList: true, subtree: true, characterData: true });
    observe();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect(); };
  }, [viewport]);
  useLayoutEffect(() => { viewport?.scrollTo({ top: 0 }); }, [viewport, page]);
  return { viewportRef: setViewport, measuredSize: size };
}
