import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

/** Decorative brand mark; the adjacent product name supplies its accessible name. */
export const IconMark = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(function IconMark(
  { children, className, ...props },
  ref,
) {
  return (
    <span {...props} ref={ref} aria-hidden="true" className={cn('ui-icon-mark', className)}>
      {children}
    </span>
  );
});
