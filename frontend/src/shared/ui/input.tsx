import * as React from 'react';
import { cn } from './utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} className={cn('ui-control ui-input', className)} ref={ref} {...props} />
  ),
);
Input.displayName = 'Input';

export { Input };
