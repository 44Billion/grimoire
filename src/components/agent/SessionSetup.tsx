/**
 * How the run was set up: the prompt it was given, and the tools it had.
 *
 * Folded away by default. A transcript is read for what happened, and a system
 * prompt is thousands of words of what was true before anything did — but when
 * an answer is strange, the prompt is very often the reason, and a reader who
 * cannot see it is left guessing about the one input they did not write.
 *
 * The tools matter for the same reason in the opposite direction: an agent that
 * did not do the obvious thing may simply not have been able to.
 */

import { useState } from "react";
import { ChevronRight, ScrollText, Wrench } from "lucide-react";

import type { DecodedDefinition } from "@/lib/agent-session/types";
import { MessageResponse } from "@/components/ai-elements/message";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function SessionSetup({
  definition,
}: {
  definition: DecodedDefinition;
}) {
  const [open, setOpen] = useState(false);
  const hasPrompt = Boolean(definition.instructions);

  // Nothing to show is not a section worth an empty box.
  if (!hasPrompt && definition.tools.length === 0) return null;

  return (
    <div className="rounded border border-dotted border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <ScrollText className="h-3 w-3 shrink-0" />
        how this session was set up
        {definition.tools.length > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {definition.tools.length}
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
          {definition.tools.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {definition.tools.map((tool) => (
                <Label
                  key={tool.name}
                  size="sm"
                  title={tool.description ?? tool.name}
                >
                  {tool.name}
                </Label>
              ))}
            </div>
          )}
          {hasPrompt && (
            <div className="max-h-96 overflow-y-auto text-xs">
              {/* The prompt is markdown, and was written to be read. */}
              <MessageResponse>{definition.instructions!}</MessageResponse>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
