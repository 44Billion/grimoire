import { cn } from "@/lib/utils";

interface LabelProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Size variant for the label
   * - sm: px-2 py-0.5 (default)
   * - md: px-3 py-1
   */
  size?: "sm" | "md";
  onClick?: (e: React.MouseEvent) => void;
  /** Native tooltip text */
  title?: string;
}

/**
 * Label/Badge component with dotted border styling
 * Used for tags, language indicators, and metadata labels
 */
export function Label({
  children,
  className,
  size = "sm",
  onClick,
  title,
}: LabelProps) {
  return (
    <span
      onClick={onClick}
      title={title}
      className={cn(
        "truncate line-clamp-1 border border-muted border-dotted text-muted-foreground text-xs",
        size === "sm" && "px-2 py-0.5",
        size === "md" && "px-3 py-1",
        className,
      )}
    >
      {children}
    </span>
  );
}
