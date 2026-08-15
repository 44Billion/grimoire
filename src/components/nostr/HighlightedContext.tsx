import type { HighlightContextSplit } from "@/lib/highlight-context";
import { cn } from "@/lib/utils";

interface HighlightedContextProps {
  split: HighlightContextSplit;
  className?: string;
}

/**
 * NIP-84 context rendering: the surrounding text with the highlighted portion
 * marked inline, styled as a terminal selection.
 */
export function HighlightedContext({
  split,
  className,
}: HighlightedContextProps) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap",
        className,
      )}
    >
      {split.before}
      <mark className="bg-highlight/15 text-foreground border-b border-dotted border-muted-foreground/40 px-0.5">
        {split.match}
      </mark>
      {split.after}
    </p>
  );
}
