import { useMemo, useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { isKnownBlock } from "@/lib/agent-session/types";
import type { DecodedTurn, TurnBlock } from "@/lib/agent-session/types";
import { RichText } from "@/components/nostr/RichText";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BaseEventContainer } from "./BaseEventRenderer";

/**
 * One turn of an agent's transcript.
 *
 * Everything structured goes through `parseAgentEvent`, which is the security
 * boundary — a turn whose author is not the agent named in its own address
 * never gets here. A turn that fails to parse still renders: its `alt` tag is
 * what a client that cannot read the blocks is supposed to show.
 */

export function AgentTurnBlocks({ blocks }: { blocks: TurnBlock[] }) {
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => (
        <AgentBlock key={index} block={block} />
      ))}
    </div>
  );
}

function Collapsible({
  title,
  tone = "muted",
  children,
}: {
  title: string;
  tone?: "muted" | "tool";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-dotted border-border">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className={cn(
          "flex w-full items-center gap-1 px-2 py-1 text-left text-xs",
          tone === "tool" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="truncate font-mono">{title}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-dotted border-border px-2 py-1 font-mono text-xs whitespace-pre-wrap">
          {children}
        </pre>
      )}
    </div>
  );
}

function AgentBlock({ block }: { block: TurnBlock }) {
  if (!isKnownBlock(block))
    // A block type this build does not know. The rest of the turn still renders
    // — that is the point of leaving the list open.
    return (
      <Collapsible title={`${block.type} (unrecognised)`}>
        {JSON.stringify(block, null, 2)}
      </Collapsible>
    );

  switch (block.type) {
    case "text":
      return <RichText content={block.text} />;

    case "thinking":
      return <Collapsible title="thinking">{block.text}</Collapsible>;

    case "tool_call":
      return (
        <Collapsible tone="tool" title={`↳ ${block.name}`}>
          {block.arguments === null
            ? `arguments too large to carry${block.arguments_digest ? ` (${block.arguments_digest})` : ""}`
            : JSON.stringify(block.arguments, null, 2)}
        </Collapsible>
      );

    case "tool_result":
      return (
        <div className="flex flex-col gap-1">
          <Collapsible
            tone="tool"
            title={`${block.name} — ${block.ok ? "ok" : "failed"}`}
          >
            {block.output ??
              (block.ref
                ? `stored out of band: ${block.ref.size} bytes, ${block.ref.sha256}`
                : "this turn carried no output")}
          </Collapsible>
          {block.truncated && (
            <Label size="sm">{block.truncated.bytes} bytes truncated</Label>
          )}
          {block.ref && (
            <a
              href={block.ref.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline"
            >
              full output ({block.ref.size} bytes)
            </a>
          )}
        </div>
      );

    case "image":
      return (
        <img
          src={block.url}
          alt=""
          className="max-h-64 max-w-full rounded border border-border"
        />
      );
  }
}

export function AgentTurnBody({ turn }: { turn: DecodedTurn }) {
  const tools = turn.blocks
    .filter(
      (block) => block.type === "tool_call" || block.type === "tool_result",
    )
    .map((block) => ("name" in block ? block.name : ""))
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Label size="sm">{turn.role}</Label>
        <Label size="sm">#{turn.seq}</Label>
        {turn.model && <Label size="sm">{turn.model.id}</Label>}
        {turn.stop && <Label size="sm">{turn.stop}</Label>}
        {turn.cost && (
          <Label size="sm">
            {turn.cost.amount} {turn.cost.currency}
          </Label>
        )}
        {tools.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Wrench className="h-3 w-3" />
            {[...new Set(tools)].join(", ")}
          </span>
        )}
      </div>
      {turn.blocks.length > 0 ? (
        <AgentTurnBlocks blocks={turn.blocks} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {turn.alt ?? "This turn carried nothing this client could read."}
        </p>
      )}
    </div>
  );
}

export function AgentTurnRenderer({ event }: { event: NostrEvent }) {
  const turn = useMemo(() => {
    const decoded = parseAgentEvent(event as never);
    return decoded?.type === "turn" ? decoded : null;
  }, [event]);

  return (
    <BaseEventContainer event={event}>
      {turn ? (
        <AgentTurnBody turn={turn} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Not a turn this session can vouch for — its author is not the agent it
          names.
        </p>
      )}
    </BaseEventContainer>
  );
}
