import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from './utils';

// Base Button: only the variants consumed by this product, without Tailwind.
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    variant?: 'default' | 'outline';
  }
>(function Button({ asChild = false, variant = 'outline', className, ...props }, ref) {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn('base-control base-button', className)} data-variant={variant} {...props} />;
});
