import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const MAX_PAGE_SIZE = 100;

export function fitPageSize(height: number, rowHeight: number, gap: number, columns: number) {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor((height + gap) / (rowHeight + gap))) * columns);
}

export function fitVariableRows(height: number, rowHeights: number[], gap: number, estimatedRowHeight: number) {
  let used = 0;
  for (const [index, rowHeight] of rowHeights.entries()) {
    used += (index === 0 ? 0 : gap) + rowHeight;
    if (used > height) return Math.max(1, index);
  }
  // Rows beyond this response use the tallest observed height. An oversized
  // row discovered by an expansion therefore cannot trigger the same expansion again.
  const additional = Math.floor((height - used) / (estimatedRowHeight + gap));
  return Math.min(MAX_PAGE_SIZE, rowHeights.length + additional);
}

/** Measure the current server window, using concrete heights for a variable-height list. */
export function usePageSize(page: number, pageSize: number, enabled = true) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [measurement, setMeasurement] = useState<{ windowKey: string; size: number } | null>(null);
  const windowKey = page + ':' + pageSize;
  const metrics = useRef({ width: 0, height: 0, rowHeight: 0 });
  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Changing layout mode detaches the old measurement before URL reconciliation.
      // Feed mode does not retain a measured DOM viewport or a stale desktop size.
      metrics.current = { width: 0, height: 0, rowHeight: 0 };
      setViewport(enabled ? node : null);
      setMeasurement(null);
    },
    [enabled],
  );
  useLayoutEffect(() => {
    if (!viewport || !enabled || !viewport.parentElement) return;
    const panel = viewport.parentElement;
    let frame = 0;
    function measure() {
      // An error notice changes the inset, but cannot define a new server window.
      // Retain the successful window until its owner permits measurement again.
      if (viewport!.dataset.pageMeasurement === 'paused') return;
      const list = viewport!.querySelector<HTMLElement>('[data-page-items]');
      if (!list || viewport!.clientHeight === 0) return;
      const variablePageTotal = list.dataset.variablePageTotal;
      const width = variablePageTotal === undefined ? viewport!.clientWidth : panel.clientWidth;
      const panelHeight = panel.clientHeight;
      // History keeps the same page boundaries until the outer panel resizes.
      // Rows and a wrapping pagination footer can change the inner scroll area.
      const previous = metrics.current;
      if (variablePageTotal !== undefined && previous.width === width && previous.height === panelHeight) return;
      const items = list.querySelectorAll<HTMLElement>('[data-page-item]');
      if (!items.length) return;
      const rowHeights = Array.from(items, (item) => item.getBoundingClientRect().height);
      const tallest = Math.max(...rowHeights);
      if (!tallest) return;
      const rowHeight = previous.width === width ? Math.max(previous.rowHeight, tallest) : tallest;
      metrics.current = { width, height: panelHeight, rowHeight };
      const style = getComputedStyle(list);
      const gap = parseFloat(style.rowGap) || 0;
      const columns = style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 1;
      const listBox = list.getBoundingClientRect();
      const inset =
        Math.max(0, listBox.top - viewport!.getBoundingClientRect().top + viewport!.scrollTop) +
        Math.max(0, viewport!.lastElementChild!.getBoundingClientRect().bottom - listBox.bottom);
      const heading = list.querySelector<HTMLElement>('[data-page-heading]')?.getBoundingClientRect().height || 0;
      const height = viewport!.clientHeight - inset - heading;
      const fitted =
        variablePageTotal === undefined
          ? fitPageSize(height, rowHeight, gap, columns)
          : Math.min(Number(variablePageTotal), fitVariableRows(height, rowHeights, gap, rowHeight));
      setMeasurement((current) =>
        current?.windowKey === windowKey && current.size === fitted ? current : { windowKey, size: fitted },
      );
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }
    const resize = new ResizeObserver(schedule);
    function observe() {
      resize.disconnect();
      resize.observe(viewport!);
      if (viewport!.querySelector('[data-variable-page-total]')) resize.observe(panel);
      viewport!
        .querySelectorAll('[data-page-items], [data-page-item], [data-page-heading]')
        .forEach((item) => resize.observe(item));
      schedule();
    }
    const changes = new MutationObserver(observe);
    changes.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-page-measurement', 'data-variable-page-total'],
    });
    observe();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
    };
  }, [viewport, enabled, page, pageSize, windowKey]);
  useLayoutEffect(() => {
    if (enabled) viewport?.scrollTo({ top: 0 });
  }, [viewport, page, enabled]);
  return { viewportRef, measuredSize: enabled && measurement?.windowKey === windowKey ? measurement.size : null };
}
