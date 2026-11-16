import type { ReactNode } from 'react';
import { ActionGroup } from './action-group';
import { cn } from './utils';

export function PageHeader({
  title,
  context,
  actions,
  back,
  className,
}: {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ui-page-header', className)}>
      <div className="ui-page-heading">
        {back}
        <div className="ui-page-copy">
          <h1 className="ui-page-title">{title}</h1>
          {context && <div className="ui-page-context">{context}</div>}
        </div>
      </div>
      {actions && (
        <ActionGroup align="start" className="ui-page-actions">
          {actions}
        </ActionGroup>
      )}
    </div>
  );
}
