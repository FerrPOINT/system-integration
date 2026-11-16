import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

/** One guard owns route changes, native unload and a form's local close action. */
export function useFormNavigationGuard({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  // Acknowledgement can arrive before React publishes mutation.isSuccess. Navigation
  // permission is released synchronously by that event, never inferred from a timer.
  const released = useRef(false);
  const [localClose, setLocalClose] = useState<(() => void) | null>(null);
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
    open: !pending && (blocker.state === 'blocked' || localClose !== null),
    release() {
      released.current = true;
      if (blocker.state === 'blocked') blocker.reset();
      setLocalClose(null);
    },
    protect() {
      released.current = false;
    },
    requestClose(close: () => void) {
      if (pending) return;
      if (!released.current && dirty) setLocalClose(() => close);
      else close();
    },
    cancel() {
      setLocalClose(null);
      if (blocker.state === 'blocked') blocker.reset();
    },
    discard() {
      setLocalClose(null);
      if (blocker.state === 'blocked') blocker.proceed();
      else localClose?.();
    },
  };
}
