import type { ReactNode } from 'react';
import { ActionGroup } from './action-group';

// Base PageHeader: ordinary title, context and actions used by this product.
export function PageHeader({ title, context, actions }: {
  title: string; context?: ReactNode; actions?: ReactNode;
}) {
  return <div className="base-page-header">
    <div className="base-page-copy"><h1 className="base-page-title">{title}</h1>
      {context && <div className="base-page-context">{context}</div>}
    </div>
    {actions && <ActionGroup align="start" className="base-page-actions">{actions}</ActionGroup>}
  </div>;
}
