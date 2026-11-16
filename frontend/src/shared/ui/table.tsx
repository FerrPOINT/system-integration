import * as React from 'react';
import { cn } from './utils';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="ui-table-scroll">
      <table ref={ref} className={cn('ui-table', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

export { Table };
