import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from './utils';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Product content; static guidance is not announced as a new error. */
  title?: ReactNode;
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  appearance?: 'panel' | 'inline';
}

const icons = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

/** Pure presentation: callers own messages, live-region urgency and all action side effects. */
export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { title, children, tone = 'neutral', appearance = 'panel', className, ...props },
  ref,
) {
  const Icon = icons[tone];
  return (
    <div {...props} ref={ref} data-tone={tone} data-appearance={appearance} className={cn('ui-notice', className)}>
      <span aria-hidden="true" className="ui-notice-icon">
        <Icon />
      </span>
      <div className="ui-notice-body">
        {title && <div className="ui-notice-title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
});
