import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  /** Optional document heading; the owner chooses its level in the surrounding page. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ message, headingLevel, description, action }: EmptyStateProps) {
  const Message = headingLevel ? (`h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') : 'p';
  return (
    <div className="ui-empty-state">
      <Message className={headingLevel ? 'ui-empty-heading' : undefined}>{message}</Message>
      {description && <p className="ui-empty-description">{description}</p>}
      {action}
    </div>
  );
}
