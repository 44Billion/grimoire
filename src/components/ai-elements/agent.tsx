"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
/**
 * Local: upstream types this as the AI SDK's `Tool`, but only reads a
 * description and a schema — IPA tools carry JSON Schema directly, and the SDK
 * is 8MB for one alias.
 */
type Tool = {
  description?: string;
  jsonSchema?: unknown;
  inputSchema?: unknown;
};
import type { ComponentProps } from "react";
import { memo } from "react";

import { HexAvatar } from "../ai/Hex";
import { ProviderLogo, providerFromModel } from "../ai/ProviderLogo";
import { ReplyCodeBlock } from "../ai/ReplyCodeBlock";

export type AgentProps = ComponentProps<"div">;

export const Agent = memo(({ className, ...props }: AgentProps) => (
  <div
    className={cn("not-prose w-full rounded-md border", className)}
    {...props}
  />
));

export type AgentHeaderProps = ComponentProps<"div"> & {
  name: string;
  model?: string;
};

export const AgentHeader = memo(
  ({ className, name, model, ...props }: AgentHeaderProps) => (
    <div
      className={cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <HexAvatar />
        <span className="font-medium text-sm">{name}</span>
        {model && (
          // Local: the provider renders as its mark, matching the turn footer.
          <Badge
            className="gap-1 font-mono text-xs"
            title={model}
            variant="secondary"
          >
            <ProviderLogo
              className="size-2.5"
              provider={providerFromModel(model)}
            />
            {providerFromModel(model)
              ? model.slice(providerFromModel(model)!.length + 1)
              : model}
          </Badge>
        )}
      </div>
    </div>
  ),
);

export type AgentContentProps = ComponentProps<"div">;

export const AgentContent = memo(
  ({ className, ...props }: AgentContentProps) => (
    <div className={cn("space-y-4 p-4 pt-0", className)} {...props} />
  ),
);

export type AgentInstructionsProps = ComponentProps<"div"> & {
  children: string;
};

export const AgentInstructions = memo(
  ({ className, children, ...props }: AgentInstructionsProps) => (
    <div className={cn("space-y-2", className)} {...props}>
      <div className="rounded-md bg-muted/50 p-3 text-muted-foreground text-sm">
        <p className="whitespace-pre-wrap break-words">{children}</p>
      </div>
    </div>
  ),
);

export type AgentToolsProps = ComponentProps<typeof Accordion>;

export const AgentTools = memo(({ className, ...props }: AgentToolsProps) => (
  <div className={cn("space-y-2", className)}>
    <span className="font-medium text-muted-foreground text-sm">Tools</span>
    <Accordion className="rounded-md border" {...props} />
  </div>
));

export type AgentToolProps = ComponentProps<typeof AccordionItem> & {
  tool: Tool;
};

export const AgentTool = memo(
  ({ className, tool, value, ...props }: AgentToolProps) => {
    const schema =
      "jsonSchema" in tool && tool.jsonSchema
        ? tool.jsonSchema
        : tool.inputSchema;

    return (
      <AccordionItem
        className={cn("border-b last:border-b-0", className)}
        value={value}
        {...props}
      >
        {/* Local: `text-left`, because grimoire's button styling centers it and
            a wrapped tool description reads as a caption. */}
        <AccordionTrigger className="px-3 py-2 text-left text-sm hover:no-underline">
          {tool.description ?? "No description"}
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3">
          <ReplyCodeBlock
            code={JSON.stringify(schema, null, 2)}
            language="json"
          />
        </AccordionContent>
      </AccordionItem>
    );
  },
);

export type AgentOutputProps = ComponentProps<"div"> & {
  schema: string;
};

export const AgentOutput = memo(
  ({ className, schema, ...props }: AgentOutputProps) => (
    <div className={cn("space-y-2", className)} {...props}>
      <span className="font-medium text-muted-foreground text-sm">
        Output Schema
      </span>
      <ReplyCodeBlock code={schema} language="typescript" />
    </div>
  ),
);

Agent.displayName = "Agent";
AgentHeader.displayName = "AgentHeader";
AgentContent.displayName = "AgentContent";
AgentInstructions.displayName = "AgentInstructions";
AgentTools.displayName = "AgentTools";
AgentTool.displayName = "AgentTool";
AgentOutput.displayName = "AgentOutput";
