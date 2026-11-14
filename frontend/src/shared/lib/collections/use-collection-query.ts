import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { projectCollection, type CollectionPage } from './project-collection';

/** React Query owns both the desktop window and the mobile page sequence. */
export function useCollectionQuery<T>({ key, page, size, feed, enabled, read, identify, refreshInterval = false }: {
  key: QueryKey; page: number; size: number; feed: boolean; enabled: boolean;
  read: (page: number, size: number, signal: AbortSignal) => Promise<CollectionPage<T>>;
  identify: (item: T) => string; refreshInterval?: number | false;
}) {
  const query = useInfiniteQuery({
    queryKey: [...key, feed ? 'feed' : 'page', feed ? 0 : page, size], enabled,
    initialPageParam: feed ? 0 : page,
    queryFn: ({ pageParam, signal }) => read(pageParam, size, signal),
    getNextPageParam: last => feed && last.hasNext ? last.page + 1 : undefined,
    placeholderData: feed ? undefined : keepPreviousData,
    refetchInterval: refreshInterval,
  });
  const pages = query.data?.pages;
  const projection = useMemo(() => projectCollection(pages, feed, identify), [pages, feed, identify]);
  return { query, ...projection };
}
