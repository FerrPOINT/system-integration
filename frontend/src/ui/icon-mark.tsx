import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "./utils";

export interface IconMarkProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md";
  /** Omit beside an existing name; a standalone mark requires its accessible name. */
  label?: string;
}

/** Resource identity decoration. The product supplies its icon and any navigation. */
export const IconMark = forwardRef<HTMLSpanElement, IconMarkProps>(
  function IconMark(
    { size = "md", label, children, style, className, ...props },
    ref,
  ) {
    return (
      <span
        {...props}
        ref={ref}
        className={cn("base-icon-mark", className)}
        data-size={size === "sm" ? "sm" : "md"}
        role={label ? "img" : undefined}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
        style={
          {
            ...style,
            "--base-icon-mark-color": "var(--color-accent)",
          } as CSSProperties
        }
      >
        {children}
      </span>
    );
  },
);
