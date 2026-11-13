import type { ReactNode } from 'react';
import { ActionGroup } from './action-group';
import { cn } from './utils';

// Base PageHeader: ordinary title, context and actions used by this product.
export function PageHeader({ title, context, actions, back, className }: {
  title: string; context?: ReactNode; actions?: ReactNode; back?: ReactNode; className?: string;
}) {
  return <div className={cn('base-page-header', className)}>
    <div className="base-page-heading">
      {back}
      <div className="base-page-copy"><h1 className="base-page-title">{title}</h1>
        {context && <div className="base-page-context">{context}</div>}
      </div>
    </div>
    {actions && <ActionGroup align="start" className="base-page-actions">{actions}</ActionGroup>}
  </div>;
}
