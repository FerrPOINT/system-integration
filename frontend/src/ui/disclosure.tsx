import {
  forwardRef,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./utils";
export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  /** Semantic emphasis; the owner determines the meaning and content. */
  tone?: "default" | "muted" | "danger";
  /** Smaller technical text follows the shared label typography preset. */
  size?: "default" | "sm";
  summaryProps?: HTMLAttributes<HTMLElement>;
}
/** A native disclosure preserves find-in-page, keyboard and no-JS behavior. */
export const Disclosure = forwardRef<HTMLDetailsElement, DisclosureProps>(
  function Disclosure(
    {
      summary,
      summaryProps,
      children,
      tone = "default",
      size = "default",
      className,
      ...props
    },
    ref,
  ) {
    const heading = (
      <summary {...summaryProps}>
        <ChevronRight aria-hidden />
        <span>{summary}</span>
      </summary>
    );
    return (
      <details
        {...props}
        ref={ref}
        className={cn("base-disclosure", className)}
        data-appearance="panel"
        data-tone={tone === "muted" || tone === "danger" ? tone : undefined}
        data-size={size === "sm" ? size : undefined}
      >
        {heading}
        <div className="base-disclosure-content">{children}</div>
      </details>
    );
  },
);
