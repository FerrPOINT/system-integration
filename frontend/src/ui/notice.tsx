import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "./utils";

export interface NoticeProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Product content; static guidance is not announced as a new error. */
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  appearance?: "panel" | "inline";
  /** Separate an inline message from preceding content using the current density. */
  separated?: boolean;
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
  {
    title,
    children,
    actions,
    icon,
    tone = "neutral",
    appearance = "panel",
    separated = false,
    className,
    ...props
  },
  ref,
) {
  const Icon = icons[tone];
  return (
    <div
      {...props}
      ref={ref}
      data-tone={tone}
      data-appearance={appearance}
      data-separated={appearance === "inline" && separated ? "true" : undefined}
      className={cn("base-notice", className)}
    >
      <span aria-hidden="true" className="base-notice-icon">
        {icon ?? <Icon />}
      </span>
      <div className="base-notice-body">
        {title && <div className="base-notice-title">{title}</div>}
        <div>{children}</div>
        {actions && <div className="base-notice-actions">{actions}</div>}
      </div>
    </div>
  );
});
