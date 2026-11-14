import { ArrowLeft } from 'lucide-react';
import { Link, type LinkProps } from 'react-router-dom';
import { Button } from './button';
import { cn } from './utils';

export function BackLink({ children, className, ...props }: Omit<LinkProps, 'children'> & { children: string }) {
  return (
    <Button asChild>
      <Link
        {...props}
        aria-label={children}
        title={children}
        className={cn('base-back-link base-icon-button', className)}
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
    </Button>
  );
}
