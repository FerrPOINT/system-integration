import * as React from 'react';
import { cn } from './utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'heading';
  appearance?: 'default' | 'inline';
}
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', appearance = 'default', ...props }, ref) => {
    return (
      <input
        type={type}
        data-variant={variant}
        data-appearance={appearance}
        className={cn('base-control base-input', className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
