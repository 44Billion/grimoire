import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

import { HEX_NAME, HexAvatar } from "./Hex";
import { ProviderLogo, providerFromModel } from "./ProviderLogo";

import { cn } from "@/lib/utils";
import type { ToolSupport } from "@/services/inference";
import type { InferenceTool } from "@/types/inference";

/**
 * Who is answering, on what, with which instructions and tools.
 *
 * Follows the shape of ai-elements' `Agent` — header with name and model,
 * instructions, tools as an accordion of input schemas — but written against
 * IPA's plain JSON-Schema tools rather than the AI SDK's `Tool` type, which
 * would pull the whole SDK back in for one alias.
 *
 * It exists because grounding and capability are otherwise invisible: the window
 * silently prepends event JSON and NIP text, and the permission dialog lists
 * only tool names. This is the page saying what it said on the user's behalf,
 * and what it offered.
 */
export function AgentPanel({
  className,
  instructions,
  model,
  toolSupport,
  tools,
}: {
  className?: string;
  instructions?: string;
  /** From the last `done` chunk; the extension chooses it, not grimoire. */
  model?: string;
  toolSupport: ToolSupport;
  tools: InferenceTool[];
}) {
  const provider = providerFromModel(model);
  const modelName = provider ? model!.slice(provider.length + 1) : model;
  const offered = toolSupport !== "none";

  return (
    <div
      className={cn("rounded border border-dashed border-border", className)}
    >
      <div className="flex items-center gap-2 px-2 py-1">
        <HexAvatar />
        <span className="text-xs font-medium">{HEX_NAME}</span>
        {model && (
          <span
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"
            title={model}
          >
            <ProviderLogo className="size-2.5" provider={provider} />
            <span className="font-mono">{modelName}</span>
          </span>
        )}
      </div>

      <Accordion
        className="border-t border-dashed border-border"
        collapsible
        type="single"
      >
        {instructions && (
          <AccordionItem className="border-b-0 px-2" value="instructions">
            <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
              Instructions · {instructions.split("\n").length} lines
            </AccordionTrigger>
            <AccordionContent>
              {/* Verbatim, not summarised: this is what was sent. */}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {instructions}
              </pre>
            </AccordionContent>
          </AccordionItem>
        )}

        {tools.length > 0 && (
          <AccordionItem className="border-b-0 px-2" value="tools">
            <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
              <span className="flex items-center gap-2">
                Tools · {tools.length}
                {toolSupport === "experimental" && (
                  <Badge className="text-[10px]" variant="secondary">
                    experimental
                  </Badge>
                )}
                {!offered && (
                  <Badge className="text-[10px]" variant="secondary">
                    not sent
                  </Badge>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              {!offered && (
                <p className="text-xs text-muted-foreground">
                  This provider offers no tool calling, so these are not sent.
                  Hex proposes commands for you to run instead.
                </p>
              )}
              {toolSupport === "experimental" && (
                <p className="text-xs text-muted-foreground">
                  Sent through the injector&apos;s experimental namespace, which
                  the spec asks applications not to depend on. It may change.
                </p>
              )}
              {tools.map((tool) => (
                <div key={tool.function.name}>
                  <div className="font-mono text-xs">{tool.function.name}</div>
                  {tool.function.description && (
                    <p className="text-xs text-muted-foreground">
                      {tool.function.description}
                    </p>
                  )}
                  {tool.function.parameters && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {JSON.stringify(tool.function.parameters, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
