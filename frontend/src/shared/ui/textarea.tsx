import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './utils';

// Base Textarea: native sizing; the product does not use autosize.
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn('base-control base-textarea', className)} {...props} />;
});
