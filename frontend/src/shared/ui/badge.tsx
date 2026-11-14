import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'info' | 'success' | 'danger';
}) {
  return <span className={cn('base-badge', className)} data-tone={tone} data-appearance="badge" {...props} />;
}
