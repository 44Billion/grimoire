import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * VisuallyHidden component for accessibility
 * Hides content visually but keeps it available for screen readers
 */
export const VisuallyHidden = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span ref={ref} className={cn("sr-only", className)} {...props} />
));

VisuallyHidden.displayName = "VisuallyHidden";
