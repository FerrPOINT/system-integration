import { forwardRef, type DetailsHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './utils';

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  summaryProps?: HTMLAttributes<HTMLElement>;
}

/** Native disclosure for filters, including keyboard and find-in-page behavior. */
export const Disclosure = forwardRef<HTMLDetailsElement, DisclosureProps>(function Disclosure(
  { summary, summaryProps, children, className, ...props },
  ref,
) {
  return (
    <details {...props} ref={ref} className={cn('ui-disclosure', className)}>
      <summary {...summaryProps}>
        <ChevronRight aria-hidden />
        <span>{summary}</span>
      </summary>
      <div className="ui-disclosure-content">{children}</div>
    </details>
  );
});
