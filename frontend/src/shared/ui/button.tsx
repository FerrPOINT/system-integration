import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: 'default' | 'outline';
  }
>(function Button({ asChild = false, variant = 'outline', className, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn('ui-control ui-button', className)} data-variant={variant} {...props} />;
});
