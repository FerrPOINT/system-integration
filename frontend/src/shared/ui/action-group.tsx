import { forwardRef, type HTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

export interface ActionGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Preserve the caller's native container and its attributes without another DOM node. */
  asChild?: boolean;
  align?: 'start' | 'end';
}

/** Layout only; actions, native button types, permissions and pending remain caller-owned. */
export const ActionGroup = forwardRef<HTMLDivElement, ActionGroupProps>(function ActionGroup(
  { asChild = false, align = 'end', className, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'div';
  return <Component {...props} ref={ref} className={cn('ui-action-group', className)} data-align={align} />;
});
