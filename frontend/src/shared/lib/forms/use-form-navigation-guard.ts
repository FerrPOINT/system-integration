import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { FormExitContext, type FormExitGuard } from './form-exit-context';

/** One guard owns route changes, shell exit, native unload and local close. */
export function useFormNavigationGuard({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  // Acknowledgement can arrive before React publishes mutation.isSuccess. Navigation
  // permission is released synchronously by that event, never inferred from a timer.
  const released = useRef(false);
  const [localClose, setLocalClose] = useState<{ close: () => void; leaving: boolean } | null>(null);
  const setExitGuard = useContext(FormExitContext);
  const exitFocus = useRef<HTMLElement | null>(null);
  const requestClose = useCallback(
    (close: () => void, leaving = false) => {
      if (pending) return;
      if (!released.current && dirty) {
        if (leaving) exitFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setLocalClose({ close, leaving });
      } else close();
    },
    [dirty, pending],
  );
  useLayoutEffect(() => {
    if (!setExitGuard) return;
    const guard: FormExitGuard = { request: (exit) => requestClose(exit, true), pending };
    setExitGuard((current) => {
      if (current) throw new Error('Only one form may own page departure');
      return guard;
    });
    return () => {
      setExitGuard(null);
    };
  }, [setExitGuard, requestClose, pending]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !released.current && (dirty || pending) && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === 'blocked' && pending) blocker.reset();
  }, [blocker, pending]);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!released.current && (dirty || pending)) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty, pending],
    ),
  );
  return {
    navigating: blocker.state === 'blocked' || Boolean(localClose?.leaving),
    exitFocusRef: localClose?.leaving ? exitFocus : undefined,
    open: !pending && (blocker.state === 'blocked' || localClose !== null),
    release() {
      released.current = true;
      if (blocker.state === 'blocked') blocker.reset();
      setLocalClose(null);
    },
    protect() {
      released.current = false;
    },
    requestClose,
    cancel() {
      setLocalClose(null);
      if (blocker.state === 'blocked') blocker.reset();
    },
    discard() {
      setLocalClose(null);
      if (blocker.state === 'blocked') blocker.proceed();
      else localClose?.close();
    },
  };
}
