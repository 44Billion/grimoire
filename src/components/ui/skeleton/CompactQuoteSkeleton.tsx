import * as React from "react";
import { Skeleton } from "./Skeleton";

export type CompactQuoteSkeletonProps = React.HTMLAttributes<HTMLDivElement>;

const CompactQuoteSkeleton = React.forwardRef<
  HTMLDivElement,
  CompactQuoteSkeletonProps
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={`my-2 border-l-2 border-muted pl-3 py-1 space-y-2 ${className || ""}`}
      role="status"
      aria-label="Loading quoted event..."
      {...props}
    >
      {/* Author name */}
      <Skeleton variant="text" width="6rem" height={16} />

      {/* Quote Content: 2 lines */}
      <div className="space-y-2">
        <Skeleton variant="text" width="100%" height={14} />
        <Skeleton variant="text" width="80%" height={14} />
      </div>
    </div>
  );
});

CompactQuoteSkeleton.displayName = "CompactQuoteSkeleton";

export { CompactQuoteSkeleton };
