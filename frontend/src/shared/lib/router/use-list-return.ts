import { useLocation } from 'react-router-dom';

/** A detail link carries only its own list's filter context. Direct links use the list root. */
export function useListReturn(base: '/tasks' | '/issues') {
  const { state } = useLocation();
  const target: unknown = state?.returnTo;
  return typeof target === 'string' && (target === base || target.startsWith(base + '?')) ? target : base;
}
