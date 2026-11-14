import {
  hashKey,
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { useLocation } from 'react-router-dom';
import { projectCollection, type CollectionPage } from './project-collection';
import { CollectionOwner } from './collection-owner';
import { FEED_PAGE_LIMIT, positionKey, readPosition, writePosition, type FeedPosition } from './feed-position-storage';
import { alignPosition, capturePosition, nearestPosition } from './feed-position-dom';
import { isCurrentLocation } from '../router/is-current-location';

type Restoration = {
  key: string;
  initialPage: number;
  phase: 'restore' | 'ready' | 'reset-start' | 'reset-restore';
  notice?: string;
};
const changed = 'Список изменился. Позиция восстановлена по доступным записям.';
const unavailable = 'Браузер не сохраняет позицию списка.';

/** React Query owns both the desktop window and the mobile page sequence. */
export function useCollection<T>({
  key,
  page,
  size,
  feed,
  enabled,
  read,
  identify,
  refreshInterval = false,
  viewportRef,
}: {
  key: QueryKey;
  page: number;
  size: number;
  feed: boolean;
  enabled: boolean;
  read: (page: number, size: number, signal: AbortSignal) => Promise<CollectionPage<T>>;
  identify: (item: T) => string;
  refreshInterval?: number | false;
  viewportRef?: Ref<HTMLDivElement>;
}) {
  const owner = useContext(CollectionOwner);
  const location = useLocation();
  const client = useQueryClient();
  const viewport = useRef<HTMLDivElement | null>(null);
  const composedRef = useComposedRefs(viewport, viewportRef);
  const queryKey = [...key, feed ? 'feed' : 'page', feed ? 0 : page, size];
  const queryHash = hashKey(queryKey);
  const cachedFirstPage = client.getQueryData<InfiniteData<CollectionPage<T>>>(queryKey)?.pages[0]?.page ?? 0;
  const search = new URLSearchParams(location.search);
  search.delete('page');
  search.delete('size');
  const route = ['/tasks', '/issues'].includes(location.pathname)
    ? location.pathname + (search.size ? '?' + search.toString() : '')
    : location.key;
  const storageKey = positionKey(owner || '', route, queryHash);
  const saved = useMemo(() => (feed ? readPosition(storageKey, size) : {}), [feed, storageKey, size]);
  const initial = useMemo<Restoration>(
    () => ({
      key: storageKey,
      initialPage: saved.position ? Math.max(0, saved.position.page - (saved.position.id ? 1 : 0)) : 0,
      phase: saved.position ? 'restore' : feed && cachedFirstPage > 0 ? 'reset-start' : 'ready',
      notice:
        saved.issue === 'invalid'
          ? 'Сохранённая позиция недоступна. Список открыт сначала.'
          : saved.issue
            ? unavailable
            : undefined,
    }),
    [storageKey, saved.position, saved.issue, feed, cachedFirstPage],
  );
  const [restoration, setRestoration] = useState<Restoration>(initial);
  if (restoration.key !== storageKey) setRestoration(initial);
  const current = restoration.key === storageKey ? restoration : initial;
  const snapshot = useRef<{ key: string; position: FeedPosition } | null>(null);
  if (feed && !owner) throw new Error('CollectionOwner is required for a mobile collection');
  const query = useInfiniteQuery({
    queryKey,
    enabled: enabled && current.phase !== 'reset-start' && current.phase !== 'reset-restore',
    initialPageParam: feed ? current.initialPage : page,
    queryFn: ({ pageParam, signal }) => read(pageParam, size, signal),
    getNextPageParam: (last) => (feed && last.hasNext ? last.page + 1 : undefined),
    getPreviousPageParam: (first) => (feed && first.page > 0 ? first.page - 1 : undefined),
    maxPages: feed ? FEED_PAGE_LIMIT : 1,
    placeholderData: feed ? undefined : keepPreviousData,
    refetchInterval: refreshInterval,
  });
  const pages = query.data?.pages;
  const { isError, isFetching, hasNextPage, fetchNextPage } = query;
  const projection = useMemo(() => projectCollection(pages, feed, identify), [pages, feed, identify]);
  const restoring = feed && current.phase !== 'ready';
  const capture = useCallback(() => {
    if (!feed || !isCurrentLocation(location) || current.phase !== 'ready') return;
    const position = capturePosition(viewport.current, pages, identify);
    if (!position) return;
    snapshot.current = { key: storageKey, position };
    const issue = writePosition(storageKey, position);
    if (issue)
      setRestoration((value) =>
        value.key === storageKey && value.notice === unavailable
          ? value
          : { ...(value.key === storageKey ? value : initial), notice: unavailable },
      );
  }, [feed, location, current.phase, pages, identify, storageKey, initial]);

  useEffect(() => {
    if (
      restoration.key !== storageKey ||
      (restoration.phase !== 'reset-start' && restoration.phase !== 'reset-restore')
    )
      return;
    let active = true;
    const next = restoration.phase === 'reset-restore' ? 'restore' : 'ready';
    client.resetQueries({ predicate: (candidate) => candidate.queryHash === queryHash }, { throwOnError: true }).then(
      () => {
        if (active) setRestoration((value) => ({ ...value, phase: next }));
      },
      () => {
        if (active) setRestoration((value) => ({ ...value, phase: 'ready' }));
      },
    );
    return () => {
      active = false;
    };
  }, [client, storageKey, queryHash, restoration.key, restoration.phase]);

  useLayoutEffect(() => {
    if (!feed || !enabled || !viewport.current || !isCurrentLocation(location)) return;
    const old = snapshot.current?.key === storageKey ? snapshot.current.position : undefined;
    // Disable native anchoring on this viewport; adjustment belongs to this controller
    // and works the same way in browsers without CSS scroll anchoring.
    const alignment = !restoring && old && pages?.length ? alignPosition(viewport.current, old) : undefined;
    // Router scroll restoration and the committed DOM must settle before measuring.
    const frame = requestAnimationFrame(() => {
      if (!isCurrentLocation(location) || !viewport.current) return;
      if (current.phase === 'reset-start' || current.phase === 'reset-restore') return;
      if (isError && current.phase === 'restore') {
        setRestoration({
          ...current,
          phase: 'ready',
          initialPage: pages?.length ? current.initialPage : 0,
          notice: 'Не удалось восстановить позицию. Повторите загрузку.',
        });
        return;
      }
      if (!pages?.length) return;
      const first = pages[0];
      const last = pages.at(-1)!;
      if (first.page >= Math.max(1, last.totalPages) && !isFetching) {
        setRestoration({
          key: storageKey,
          phase: 'reset-start',
          initialPage: 0,
          notice: 'Список изменился. Он открыт сначала.',
        });
        return;
      }
      if (current.phase === 'restore' && saved.position) {
        const wanted = saved.position;
        if ((first.page > wanted.page || last.page < current.initialPage) && !isFetching) {
          setRestoration({ ...current, phase: 'reset-restore' });
          return;
        }
        const result = alignPosition(viewport.current, wanted);
        if (
          result !== 'restored' &&
          hasNextPage &&
          pages.length < FEED_PAGE_LIMIT &&
          (result === 'insufficient' || last.page < wanted.page + 1)
        ) {
          if (!isFetching) fetchNextPage({ cancelRefetch: false });
          return;
        }
        if (result !== 'restored') alignPosition(viewport.current, nearestPosition(wanted, pages, identify));
        setRestoration({ ...current, phase: 'ready', notice: result === 'restored' ? undefined : changed });
        const position = capturePosition(viewport.current, pages, identify);
        if (position) {
          snapshot.current = { key: storageKey, position };
          writePosition(storageKey, position);
        }
      } else {
        if (old && alignment === 'missing') {
          alignPosition(viewport.current, nearestPosition(old, pages, identify));
          setRestoration((value) =>
            value.key === storageKey && value.notice === changed ? value : { ...current, notice: changed },
          );
        }
        capture();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    feed,
    enabled,
    location,
    storageKey,
    pages,
    identify,
    restoring,
    current,
    saved.position,
    isError,
    isFetching,
    hasNextPage,
    fetchNextPage,
    capture,
  ]);

  useLayoutEffect(() => {
    if (!feed || current.phase !== 'ready') return;
    let frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    const beforeLeave = () => capture();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pointerdown', beforeLeave, true);
    window.addEventListener('keydown', beforeLeave, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pointerdown', beforeLeave, true);
      window.removeEventListener('keydown', beforeLeave, true);
    };
  }, [feed, current.phase, capture]);

  return {
    query,
    ...projection,
    viewportRef: composedRef,
    restoring,
    positionNotice: restoring ? 'Восстанавливаем позицию…' : current.notice,
    loadNext: () => {
      capture();
      return query.fetchNextPage({ cancelRefetch: false });
    },
    loadPrevious: () => {
      capture();
      return query.fetchPreviousPage({ cancelRefetch: false });
    },
    refresh: () => {
      capture();
      return query.refetch();
    },
  };
}
