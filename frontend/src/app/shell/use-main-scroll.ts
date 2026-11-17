import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useMediaQuery } from '../../shared/ui/use-media-query';

/** Router restores the mobile document; the shell owns its desktop scroll container. */
export function useMainScroll() {
  const main = useRef<HTMLElement>(null);
  const positions = useRef(new Map<string, number>());
  const restoring = useRef(false);
  const { key, pathname } = useLocation();
  const previousPath = useRef(pathname);
  const navigation = useNavigationType();
  const mobile = useMediaQuery('(max-width: 760px)');

  useLayoutEffect(() => {
    const node = main.current;
    const changedScreen = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (mobile || !node) return;
    // Filters and history pagination retain their feature-owned scroll position.
    if (navigation !== 'POP' && !changedScreen) return;
    const top = navigation === 'POP' ? (positions.current.get(key) ?? 0) : 0;
    restoring.current = true;
    const restore = () => {
      if (top && node.querySelector('[data-scope="page"][aria-busy="true"]')) return;
      node.scrollTop = top;
      restoring.current = false;
      observer.disconnect();
    };
    // A loading screen must not erase a POP position before content arrives.
    const observer = new MutationObserver(restore);
    observer.observe(node, { childList: true, subtree: true });
    restore();
    return () => {
      observer.disconnect();
      restoring.current = false;
    };
  }, [key, pathname, navigation, mobile]);

  const capture = () => {
    if (mobile || restoring.current || !main.current) return;
    positions.current.delete(key);
    positions.current.set(key, main.current.scrollTop);
    if (positions.current.size > 32) positions.current.delete(positions.current.keys().next().value!);
  };
  return { ref: main, onScroll: capture, onPointerDownCapture: capture, onKeyDownCapture: capture };
}
