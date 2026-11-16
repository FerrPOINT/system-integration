import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Subscribe to the required browser API; layout and actions remain with the caller. */
export function useMediaQuery(query: string): boolean {
  const media = useMemo(() => window.matchMedia(query), [query]);
  const subscribe = useCallback(
    (notify: () => void) => {
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    [media],
  );
  const snapshot = useCallback(() => media.matches, [media]);
  return useSyncExternalStore(subscribe, snapshot);
}
