import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Brain,
  ChevronRight,
} from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { isKnownPart } from "@/lib/agent-session/types";
import type { DecodedTurn, TurnPart } from "@/lib/agent-session/types";
import { Markdown } from "@/components/Markdown";
import { RichText } from "@/components/nostr/RichText";
import { Label } from "@/components/ui/label";
import { ToolExchangeRow, ToolResultRow } from "@/components/agent/tool-parts";
import {
  blockTotals,
  groupTurns,
  type TranscriptBlock,
} from "@/components/agent/transcript";
import { UserName } from "@/components/nostr/UserName";
import Timestamp from "@/components/Timestamp";
import { ProviderLogo, splitModel } from "@/components/ProviderLogo";
import { cn } from "@/lib/utils";
import { BaseEventContainer } from "./BaseEventRenderer";

/**
 * One turn of an agent's transcript, laid out like a conversation.
 *
 * The grammar is the `ai` window's, because it is the same object: what the
 * person said sits right in a bubble, what the agent said sits left as prose,
 * reasoning is folded away, and a tool is a quiet row rather than a block of
 * JSON. What differs is that this one is READ — there is no streaming cursor and
 * nothing to approve — so the per-turn metadata (`seq`, model, stop, cost) is
 * pushed to a footer instead of a header: a reader wants the conversation, and
 * reaches for the sequence number only when something looks wrong.
 *
 * Everything structured goes through `parseAgentEvent`, which is the security
 * boundary — a turn whose author is not the agent named in its own address never
 * gets here. A turn that fails to parse still renders: its `alt` tag is what a
 * client that cannot read the parts is supposed to show.
 */

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
        <Brain className="h-3 w-3" />
        <span>Reasoning</span>
      </button>
      {open && (
        <p className="border-l-2 border-border pl-3 text-xs whitespace-pre-wrap text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
}

function AgentPart({
  part,
  side,
}: {
  part: TurnPart;
  side?: "user" | "agent";
}) {
  if (!isKnownPart(part))
    // A part type this build does not know. The rest of the turn still renders
    // — that is the point of leaving the list open.
    return (
      <div className="rounded border border-dotted border-border px-2 py-1">
        <p className="text-xs text-muted-foreground">
          a {String(part.type)} part, which this build cannot show
        </p>
      </div>
    );

  switch (part.type) {
    case "text":
      /**
       * Whose prose it is decides which renderer reads it.
       *
       * A model writes markdown, so the agent side gets the same renderer the
       * `ai` window uses — a transcript full of literal asterisks is the failure
       * that avoids. A person writes Nostr: an npub or an nevent in a question
       * is a reference to someone or something, and `RichText` is what turns it
       * into the name or the note rather than sixty characters of base32.
       */
      return side === "user" ? (
        <RichText content={part.text} className="text-sm" />
      ) : (
        <Markdown>{part.text}</Markdown>
      );

    case "reasoning":
      return <Reasoning text={part.text} />;

    case "tool_call":
      // Reached only when a call arrives with no result in view — grouping pairs
      // them everywhere else.
      return (
        <ToolExchangeRow
          item={{
            kind: "tool",
            id: part.id,
            name: part.name,
            arguments: part.arguments,
            argumentsDigest: part.arguments_digest,
          }}
        />
      );

    case "tool_result":
      return (
        <div className="flex flex-col gap-1">
          <ToolResultRow
            result={{
              name: part.name,
              ok: part.ok,
              output:
                part.output ??
                (part.ref
                  ? `stored out of band: ${part.ref.size} bytes, ${part.ref.sha256}`
                  : null),
            }}
          />
          {part.truncated && (
            <Label size="sm">{part.truncated.bytes} bytes truncated</Label>
          )}
          {part.ref && (
            <a
              href={part.ref.url}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-xs text-muted-foreground underline"
            >
              full output ({part.ref.size} bytes)
            </a>
          )}
        </div>
      );

    case "image":
      return (
        <img
          src={part.url}
          alt=""
          className="max-h-64 max-w-full rounded border border-border"
        />
      );
  }
}

export function AgentTurnParts({ parts }: { parts: TurnPart[] }) {
  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, index) => (
        <AgentPart key={index} part={part} />
      ))}
    </div>
  );
}

/**
 * One side's contribution, as one block.
 *
 * The agent's consecutive turns are folded together — a step that reasons, calls
 * three tools and answers is one thing it did, not four messages — and a tool
 * call carries its own result, because on the page they are one row even though
 * the wire had to publish them as two turns.
 */
export function TranscriptBlockBody({ block }: { block: TranscriptBlock }) {
  const isUser = block.side === "user";
  const totals = blockTotals(block);
  // `ppq/moonshotai/kimi-k3` is a route, a vendor and a name. The logo is the
  // vendor's; the text is the name. The whole string stays in the tooltip.
  const model = splitModel(totals.model, totals.provider);

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      {/*
        Who spoke on the left, what it cost on the right, and the gap between
        them doing the work — the same split the `ai` window uses on an assistant
        message. A reader following the conversation never has to read past the
        name; a reader auditing the spend finds every figure in one column.
      */}
      <div
        className={cn(
          "flex w-full max-w-full flex-wrap items-center gap-x-2 gap-y-0.5",
          // The prompt's own name belongs over the prompt, which sits right.
          isUser && "justify-end",
        )}
      >
        {block.speaker && (
          <span className="flex items-center gap-1 text-sm">
            <UserName pubkey={block.speaker} />
            {/* After the name, the way a badge follows a name. The agent side of
                a transcript is always a machine, and it is said with an icon
                rather than left to a kind 0 that may not declare it. */}
            {!isUser && <Bot className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          <Timestamp timestamp={block.at} />
        </span>

        {!isUser && (
          <span className="ml-auto flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground/80">
            {totals.stop && (
              <span className="text-destructive/80">{totals.stop}</span>
            )}
            {model.label && (
              <span className="flex items-center gap-1" title={totals.model}>
                <ProviderLogo provider={model.vendor} />
                {model.label}
              </span>
            )}
            {(totals.input > 0 || totals.output > 0) && (
              <>
                <span
                  className="flex items-center gap-0.5"
                  title={`${totals.input.toLocaleString()} input tokens`}
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  {totals.input.toLocaleString()}
                </span>
                <span
                  className="flex items-center gap-0.5"
                  title={`${totals.output.toLocaleString()} output tokens`}
                >
                  <ArrowUpFromLine className="h-3 w-3" />
                  {totals.output.toLocaleString()}
                </span>
              </>
            )}
            {totals.cost && (
              <span title="What this block cost">
                {totals.cost.amount} {totals.cost.currency}
              </span>
            )}
          </span>
        )}
      </div>

      {/*
        The prompt sits right and carries no container.
        A bubble says "message in a chat app"; this is a transcript, and the
        agent's side has no bubble to answer it with — one filled block against
        an unfilled one reads as emphasis nobody meant. Position is enough to say
        who spoke.
      */}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          isUser ? "max-w-[85%] text-right" : "w-full",
        )}
      >
        {block.items.length > 0 ? (
          block.items.map((item, index) =>
            item.kind === "tool" ? (
              <ToolExchangeRow key={`${item.id}-${index}`} item={item} />
            ) : (
              <AgentPart key={index} part={item.part} side={block.side} />
            ),
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            {block.turns[0]?.alt ??
              "This turn carried nothing this client could read."}
          </p>
        )}
      </div>
    </div>
  );
}

/** One turn on its own, for the feed and detail registries. */
export function AgentTurnBody({
  turn,
  operator,
}: {
  turn: DecodedTurn;
  operator?: string;
}) {
  const [block] = groupTurns([turn], operator);
  return block ? <TranscriptBlockBody block={block} /> : null;
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
