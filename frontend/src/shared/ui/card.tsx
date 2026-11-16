import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }>(
  ({ asChild = false, className, ...props }, ref) => {
    const Container = asChild ? Slot : 'div';
    return <Container {...props} ref={ref} className={cn('ui-card', className)} />;
  },
);
Card.displayName = 'Card';

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ asChild = false, className, ...props }, ref) => {
  const Heading = asChild ? Slot : 'h3';
  return <Heading ref={ref} className={cn('ui-card-title', className)} {...props} />;
});
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { density?: 'default' | 'compact' }
>(({ className, density = 'default', ...props }, ref) => (
  <div ref={ref} className={cn('ui-card-content', className)} data-density={density} {...props} />
));
CardContent.displayName = 'CardContent';

export { Card, CardTitle, CardContent };
