import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePageSize } from './use-page-size';
import { isCurrentLocation } from '../router/is-current-location';

export function usePagination(mode: 'pages' | 'feed' = 'pages') {
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const page = Number(search.get('page') ?? 0);
  const size = Number(search.get('size') ?? 20);
  const valid = Number.isSafeInteger(page) && page >= 0 && Number.isSafeInteger(size) && size >= 1 && size <= 100;
  const { viewportRef, measuredSize } = usePageSize(page, mode === 'pages');
  useEffect(() => {
    if (!valid) return;
    // The router can update the address before its transitioned React location.
    // A queued measurement must not overwrite a newer route or filter navigation.
    if (!isCurrentLocation(location)) return;
    const updated = new URLSearchParams(search);
    if (mode === 'feed') {
      if (!updated.has('page') && !updated.has('size')) return;
      updated.delete('page'); updated.delete('size');
      setSearch(updated, { replace: true });
      return;
    }
    if (measuredSize === null || measuredSize === size) return;
    updated.set('size', String(measuredSize));
    // Keep the old first record within the new server page; filters stay in the URL.
    if (page > 0 || updated.has('page')) updated.set('page', String(Math.floor(page * size / measuredSize)));
    setSearch(updated, { replace: true });
  }, [valid, measuredSize, size, page, search, setSearch, location, mode]);
  function changePage(next: number) {
    const updated = new URLSearchParams(search); updated.set('page', String(next)); setSearch(updated);
  }
  return { page: mode === 'feed' ? 0 : page, size: mode === 'feed' ? 20 : size, valid, viewportRef, changePage };
}
