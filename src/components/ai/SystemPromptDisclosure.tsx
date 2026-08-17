import { ChevronDown, FileText } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The system prompt, verbatim and collapsed.
 *
 * Grounding is invisible by construction: the window silently prepends event
 * JSON, kind metadata, and NIP text to what the user typed. If the page is
 * going to speak on the user's behalf it has to show exactly what it said, so
 * this is the sent text — not a summary of it.
 */
export function SystemPromptDisclosure({
  className,
  prompt,
}: {
  className?: string;
  prompt: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = prompt.split("\n").length;

  return (
    <Collapsible
      className={cn("rounded border border-dashed border-border", className)}
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <FileText className="size-3" />
        <span>
          System prompt · {lines} {lines === 1 ? "line" : "lines"}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          {prompt}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
