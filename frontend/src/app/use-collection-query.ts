import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { HistoryPage } from '../../build/generated/openapi/client';
import { keys } from './api';

type Window<T> = Omit<HistoryPage, 'items'> & { items: T[] };

/** React Query owns both the desktop window and the mobile page sequence. */
export function useCollectionQuery<T>({ key, page, size, feed, enabled, read, identify, refreshInterval = false }: {
  key: QueryKey; page: number; size: number; feed: boolean; enabled: boolean;
  read: (page: number, size: number, signal: AbortSignal) => Promise<Window<T>>;
  identify: (item: T) => string; refreshInterval?: number | false;
}) {
  const query = useInfiniteQuery({
    queryKey: keys.collection(key, feed, page, size), enabled,
    initialPageParam: feed ? 0 : page,
    queryFn: ({ pageParam, signal }) => read(pageParam, size, signal),
    getNextPageParam: last => feed && last.hasNext ? last.page + 1 : undefined,
    placeholderData: feed ? undefined : keepPreviousData,
    refetchInterval: refreshInterval,
  });
  const pages = query.data?.pages;
  const last = pages?.at(-1);
  // Offset pages can overlap when a new record arrives before the next request.
  const items = pages ? feed
    ? [...new Map(pages.flatMap(window => window.items).map(item => [identify(item), item])).values()]
    : pages[0].items : [];
  return { ...query, data: last ? { ...last, items } : undefined };
}
