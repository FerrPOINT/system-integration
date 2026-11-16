import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  /** Optional document heading; the owner chooses its level in the surrounding page. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, headingLevel, description, icon, action }: EmptyStateProps) {
  const Message = headingLevel ? (`h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'p';
  return (
    <div className="base-empty-state">
      {icon}
      <Message className={headingLevel ? 'base-empty-heading' : undefined}>{message}</Message>
      {description && <p className="base-empty-description">{description}</p>}
      {action}
    </div>
  );
}
