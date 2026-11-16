import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

type TimelineProps = ComponentPropsWithoutRef<'ol'> & {
  asChild?: boolean;
  appearance?: 'activity' | 'steps';
};

/** Presentation of an ordered history, not a workflow engine or step selector. */
export const Timeline = forwardRef<HTMLOListElement, TimelineProps>(
  ({ asChild = false, appearance = 'activity', className, ...props }, ref) => {
    const Component = asChild ? Slot : 'ol';
    return <Component {...props} ref={ref} className={cn('base-timeline', className)} data-appearance={appearance} />;
  },
);
Timeline.displayName = 'Timeline';

/** The caller supplies the order, status text and any permitted actions. */
export const TimelineItem = forwardRef<HTMLLIElement, ComponentPropsWithoutRef<'li'> & { asChild?: boolean }>(
  ({ asChild = false, className, ...props }, ref) => {
    const Component = asChild ? Slot : 'li';
    return <Component {...props} ref={ref} className={cn('base-timeline-item', className)} />;
  },
);
TimelineItem.displayName = 'TimelineItem';

type MarkerProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'small' | 'large';
  current?: boolean;
};

/** Decorative only: meaningful state must also appear in the item's content. */
export const TimelineMarker = forwardRef<HTMLDivElement, MarkerProps>(
  ({ tone = 'neutral', size = 'small', current = false, className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      aria-hidden="true"
      className={cn('base-timeline-marker', className)}
      data-tone={tone}
      data-size={size}
      data-current={current || undefined}
    >
      <span />
    </div>
  ),
);
TimelineMarker.displayName = 'TimelineMarker';

export const TimelineContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { asChild?: boolean }>(
  ({ asChild = false, className, ...props }, ref) => {
    const Component = asChild ? Slot : 'div';
    return <Component {...props} ref={ref} className={cn('base-timeline-content', className)} />;
  },
);
TimelineContent.displayName = 'TimelineContent';
