import { forwardRef, type HTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

export interface ActionGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Preserve the caller's native container and its attributes without another DOM node. */
  asChild?: boolean;
  align?: 'start' | 'end' | 'between';
  /** Vertical actions stretch across the container; horizontal actions wrap. */
  orientation?: 'horizontal' | 'vertical';
  separated?: boolean;
  /** Stack direct actions and nested action groups below the shared mobile breakpoint. */
  stackOnMobile?: boolean;
}

/** Layout only; actions, native button types, permissions and pending remain caller-owned. */
export const ActionGroup = forwardRef<HTMLDivElement, ActionGroupProps>(function ActionGroup(
  {
    asChild = false,
    align = 'end',
    orientation = 'horizontal',
    separated = false,
    stackOnMobile = false,
    className,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'div';
  const placement = ['start', 'end', 'between'].includes(align) ? align : 'end';
  return (
    <Component
      {...props}
      ref={ref}
      className={cn('base-action-group', className)}
      data-align={placement}
      data-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      data-separated={separated || undefined}
      data-mobile-stack={stackOnMobile || undefined}
    />
  );
});
