import { forwardRef, type ComponentPropsWithoutRef, type HTMLAttributes } from 'react';
import { cn } from './utils';

/** Presentation of an ordered history; callers supply records and their meaning. */
export const Timeline = forwardRef<HTMLOListElement, ComponentPropsWithoutRef<'ol'>>(({ className, ...props }, ref) => (
  <ol {...props} ref={ref} className={cn('ui-timeline', className)} />
));
Timeline.displayName = 'Timeline';

export const TimelineItem = forwardRef<HTMLLIElement, ComponentPropsWithoutRef<'li'>>(
  ({ className, ...props }, ref) => <li {...props} ref={ref} className={cn('ui-timeline-item', className)} />,
);
TimelineItem.displayName = 'TimelineItem';

/** Decorative only: meaningful state appears in the item's content. */
export const TimelineMarker = forwardRef<HTMLDivElement, Omit<HTMLAttributes<HTMLDivElement>, 'children'>>(
  ({ className, ...props }, ref) => (
    <div {...props} ref={ref} aria-hidden="true" className={cn('ui-timeline-marker', className)}>
      <span />
    </div>
  ),
);
TimelineMarker.displayName = 'TimelineMarker';

export const TimelineContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div {...props} ref={ref} className={cn('ui-timeline-content', className)} />,
);
TimelineContent.displayName = 'TimelineContent';
