/**
 * How the run was set up: the prompt it was given, and the tools it had.
 *
 * Folded away by default. A transcript is read for what happened, and a system
 * prompt is thousands of words of what was true before anything did — but when
 * an answer is strange, the prompt is very often the reason, and a reader who
 * cannot see it is left guessing about the one input they did not write. The
 * tools matter the same way in the opposite direction: an agent that did not do
 * the obvious thing may simply not have been able to.
 *
 * The same `Agent` element the `ai` window's own `AgentPanel` uses, deliberately.
 * These are one object seen from two ends — a run being written, and a run being
 * read — and a difference in how the two describe an agent's setup is a bug
 * waiting to be reported as "the published copy looks wrong". What differs is
 * only what is true: the face is the one the agent declared for itself in its
 * own definition, not Hex's, because a published transcript belongs to some
 * other agent on some other machine.
 */

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions,
  AgentTool,
  AgentTools,
} from "@/components/ai-elements/agent";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DecodedDefinition } from "@/lib/agent-session/types";
import { cn } from "@/lib/utils";

export function SessionSetup({
  definition,
  model,
}: {
  definition: DecodedDefinition;
  model?: string;
}) {
  const [open, setOpen] = useState(false);
  const instructions = definition.instructions;

  // Nothing to show is not a section worth an empty box.
  if (!instructions && definition.tools.length === 0) return null;

  return (
    <Agent>
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger className="w-full cursor-pointer text-left">
          <AgentHeader
            avatar={
              definition.picture ? (
                <img
                  alt=""
                  className="size-4 shrink-0 rounded-sm object-cover"
                  height={16}
                  src={definition.picture}
                  width={16}
                />
              ) : undefined
            }
            model={model}
            name={definition.name}
          >
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </AgentHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <AgentContent>
            {instructions && (
              <Accordion collapsible type="single">
                <AccordionItem className="border-b-0" value="instructions">
                  {/* Matches the "Tools" heading AgentTools renders. */}
                  <AccordionTrigger className="py-0 font-medium text-muted-foreground text-sm hover:no-underline">
                    Instructions
                  </AccordionTrigger>
                  <AccordionContent>
                    {/* Verbatim, not summarised: this is what the run was told. */}
                    <AgentInstructions className="max-h-64 overflow-auto text-xs [&_p]:text-xs">
                      {instructions}
                    </AgentInstructions>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {definition.tools.length > 0 && (
              <AgentTools collapsible type="single">
                {definition.tools.map((tool) => (
                  <AgentTool
                    key={tool.name}
                    tool={{
                      description: tool.description
                        ? `${tool.name} — ${tool.description}`
                        : tool.name,
                      jsonSchema: tool.parameters,
                    }}
                    value={tool.name}
                  />
                ))}
              </AgentTools>
            )}
          </AgentContent>
        </CollapsibleContent>
      </Collapsible>
    </Agent>
  );
}
