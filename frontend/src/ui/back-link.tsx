import { ArrowLeft } from 'lucide-react';
import { Link, type LinkProps } from 'react-router-dom';
import { Button } from './button';

export function BackLink({ children, ...props }: LinkProps) {
  return <Button asChild><Link {...props}><ArrowLeft size={16} aria-hidden="true" />{children}</Link></Button>;
}
