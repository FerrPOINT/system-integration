import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Browser query subscription; layout, focus and actions remain with its owner. */
export function useMediaQuery(
  query: string,
  /** Runs only on a browser change, before React updates the previous layout. */
  onChange?: (matches: boolean) => void,
): boolean {
  const media = useMemo(
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query)
        : null,
    [query],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!media) return () => {};
      const changed = () => {
        onChange?.(media.matches);
        notify();
      };
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    [media, onChange],
  );
  const snapshot = useCallback(() => media?.matches ?? false, [media]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
