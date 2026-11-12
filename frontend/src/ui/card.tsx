import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "./utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    asChild?: boolean;
    interactive?: boolean;
    /** Surface level for nested panels; resolved through the current branding. */
    surface?: "default" | "raised";
    /** Visual emphasis only; selection, drop eligibility and ARIA stay with the owner. */
    highlighted?: boolean;
  }
>(
  (
    {
      asChild = false,
      interactive = false,
      surface = "default",
      highlighted = false,
      className,
      ...props
    },
    ref,
  ) => {
    const Container = asChild ? Slot : "div";
    return (
      <Container
        {...props}
        ref={ref}
        className={cn("base-card", className)}
        data-interactive={interactive ? "true" : undefined}
        data-surface={surface}
        data-highlighted={highlighted ? "true" : undefined}
      />
    );
  },
);
Card.displayName = "Card";

type CardSectionProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Compact content uses control padding; default content uses panel padding. */
  density?: "default" | "compact";
};

const CardHeader = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, density = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("base-card-header", className)}
      data-density={density}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement> & { asChild?: boolean }
>(({ asChild = false, className, ...props }, ref) => {
  const Heading = asChild ? Slot : "h3";
  return (
    <Heading
      ref={ref}
      className={cn("base-card-title", className)}
      {...props}
    />
  );
});
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & {
    /** Secondary text by default; muted supports less prominent context. */
    tone?: "default" | "muted";
  }
>(({ className, tone = "default", ...props }, ref) => (
  <p
    {...props}
    ref={ref}
    className={cn("base-card-description", className)}
    data-tone={tone}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, CardSectionProps>(
  ({ className, density = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("base-card-content", className)}
      data-density={density}
      {...props}
    />
  ),
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
