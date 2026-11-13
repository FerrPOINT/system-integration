import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePageSize } from '../ui/use-page-size';

export function usePagination() {
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') ?? 0);
  const size = Number(search.get('size') ?? 20);
  const valid = Number.isSafeInteger(page) && page >= 0 && Number.isSafeInteger(size) && size >= 1 && size <= 100;
  const { viewportRef, measuredSize } = usePageSize(page);
  useEffect(() => {
    if (!valid || measuredSize === null || measuredSize === size) return;
    // BrowserRouter updates the address before its transitioned React location.
    // A queued measurement must not overwrite a newer route or filter navigation.
    if (window.location.pathname !== location.pathname || window.location.search !== location.search ||
      window.location.hash !== location.hash) return;
    const updated = new URLSearchParams(search);
    updated.set('size', String(measuredSize));
    // Keep the old first record within the new server page; filters stay in the URL.
    if (page > 0 || updated.has('page')) updated.set('page', String(Math.floor(page * size / measuredSize)));
    setSearch(updated, { replace: true });
  }, [valid, measuredSize, size, page, search, setSearch, location]);
  function changePage(next: number) {
    const updated = new URLSearchParams(search); updated.set('page', String(next)); setSearch(updated);
  }
  return { page, size, valid, viewportRef, changePage };
}
