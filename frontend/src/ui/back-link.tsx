import { ArrowLeft } from 'lucide-react';
import { Link, type LinkProps } from 'react-router-dom';
import { Button } from './button';
import { cn } from './utils';

export function BackLink({ children, className, ...props }: LinkProps) {
  return <Button asChild><Link {...props} className={cn('base-back-link', className)}><ArrowLeft size={16} aria-hidden="true" /><span className="base-back-label">{children}</span></Link></Button>;
}
