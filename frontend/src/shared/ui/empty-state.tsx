import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <h2 className="ui-empty-heading">{message}</h2>
      {description && <p className="ui-empty-description">{description}</p>}
      {action}
    </div>
  );
}
