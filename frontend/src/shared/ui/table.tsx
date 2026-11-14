import * as React from 'react';
import { cn } from './utils';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="base-table-scroll">
      <table ref={ref} className={cn('base-table', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={className} {...props} />,
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement> & {
    /** Visual selection only; the owner supplies selection actions and semantics. */
    selected?: boolean;
  }
>(({ className, selected = false, ...props }, ref) => (
  <tr {...props} ref={ref} className={className} data-selected={selected ? 'true' : undefined} />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <th ref={ref} className={className} {...props} />,
);
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & {
    /** Literal identifiers and technical values use the shared monospace token. */
    technical?: boolean;
    /** Label typography only; row height and hit targets remain unchanged. */
    size?: 'default' | 'sm';
  }
>(({ className, technical = false, size = 'default', ...props }, ref) => (
  <td
    ref={ref}
    className={className}
    {...props}
    data-technical={technical || undefined}
    data-text-size={size === 'sm' ? size : undefined}
  />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
