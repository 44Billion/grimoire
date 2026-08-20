import { useMemo } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Bot } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { isKnownPart } from "@/lib/agent-session/types";
import type { DecodedTurn, TurnPart } from "@/lib/agent-session/types";
import { Check, Users } from "lucide-react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { InputRequestRow } from "@/components/agent/InputRequest";
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
import { ProviderLogo, splitModel } from "@/components/ai/ProviderLogo";
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

/**
 * A trace, rendered the way the `ai` window renders one.
 *
 * It was a hand-rolled disclosure with a chevron and a `<p>`; ai-elements'
 * `Reasoning` is the same affordance with the same collapsed default, and using
 * it means a thought written in one window and read in the other looks like the
 * same thought. Collapsed always: the trigger already says there was thinking,
 * and an expanded trace pushes the answer down the pane.
 */
function ReasoningPart({ text }: { text: string }) {
  return (
    <Reasoning className="w-full" defaultOpen={false}>
      <ReasoningTrigger />
      {/* Quoted and smaller, matching the `ai` window: a trace is something the
          agent said to itself and must not compete with the answer. */}
      <ReasoningContent className="mt-2 border-l-2 border-border pl-3 text-xs [&_li]:text-xs [&_p]:text-xs">
        {text}
      </ReasoningContent>
    </Reasoning>
  );
}

function AgentPart({
  part,
  side,
  session,
  pending,
}: {
  part: TurnPart;
  side?: "user" | "agent";
  /** Which session this turn belongs to, so a question can be answered. */
  session?: { agent: string; session: string };
  /** Requests still open, so an answered one renders as history. */
  pending?: string[];
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
        /* `text-sm`, like the question above it and like every event body in
           grimoire. Markdown's base size made the reply the largest text on
           screen, which reads as a different application. */
        <MessageResponse className="max-w-full break-words text-sm">
          {part.text}
        </MessageResponse>
      );

    case "reasoning":
      return <ReasoningPart text={part.text} />;

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

    case "input_request":
      /**
       * Rendered as settled here, because a bare part has no session behind it
       * — the block renderer knows the address and the pending set, and passes
       * both. A question with no way to answer it is still worth showing; a
       * button that goes nowhere is not.
       */
      return (
        <InputRequestRow
          part={part}
          agent={session?.agent ?? ""}
          session={session?.session ?? ""}
          settled={!session || !pending?.includes(part.requestId)}
        />
      );

    case "input_resolved":
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3 w-3 shrink-0" />
          {part.response?.optionId ?? part.response?.text ?? part.outcome}
        </p>
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
export function TranscriptBlockBody({
  block,
  /**
   * Requests the session is still blocked on.
   *
   * Passed down rather than read here: a block knows what was asked, and only
   * the head knows whether it is still being asked. Without it every question
   * ever asked would render as live, which is worse than none of them doing.
   */
  pending,
}: {
  block: TranscriptBlock;
  pending?: string[];
}) {
  const isUser = block.side === "user";
  const totals = blockTotals(block);
  // `ppq/moonshotai/kimi-k3` is a route, a vendor and a name. The logo is the
  // vendor's; the text is the name. The whole string stays in the tooltip.
  const model = splitModel(totals.model, totals.provider);

  return (
    <div className={cn("flex w-full flex-col items-start gap-1")}>
      {/*
        Who spoke on the left, what it cost on the right, and the gap between
        them doing the work — the same split the `ai` window uses on an assistant
        message. A reader following the conversation never has to read past the
        name; a reader auditing the spend finds every figure in one column.
      */}
      <div className="flex w-full max-w-full flex-wrap items-center gap-x-2 gap-y-0.5">
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
        Everything reads down one column, the way the chat window does.
        A prompt is a message in the same conversation as the answer, not a
        separate side of it — and a transcript that alternates margins makes a
        reader's eye do work the content does not need. The name over each block
        says who spoke.
      */}
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          isUser ? "max-w-[85%]" : "w-full",
        )}
      >
        {/*
          A subagent ran, and its work is somewhere else.
          Named rather than linked: the child is a separate session with its own
          head and chain, and unless somebody followed it there is no transcript
          to open. A link that goes nowhere is worse than a sentence that says
          where to look.
        */}
        {block.turns.flatMap((turn) => turn.subagents).length > 0 && (
          <div className="flex flex-col gap-1">
            {block.turns
              .flatMap((turn) => turn.subagents)
              .map((child) => (
                <p
                  key={child.callId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  title={
                    child.session
                      ? `runtime session ${child.session}`
                      : "the runtime named no session for this one"
                  }
                >
                  <Users className="h-3 w-3 shrink-0" />
                  <span>
                    delegated to {child.name ?? "a subagent"}
                    {child.session ? (
                      <span className="ml-1 font-mono opacity-70">
                        {child.session.slice(0, 12)}…
                      </span>
                    ) : null}
                  </span>
                </p>
              ))}
          </div>
        )}

        {block.items.length > 0 ? (
          block.items.map((item, index) =>
            item.kind === "tool" ? (
              <ToolExchangeRow key={`${item.id}-${index}`} item={item} />
            ) : (
              <AgentPart
                key={index}
                part={item.part}
                side={block.side}
                session={block.turns[0]?.session}
                pending={pending}
              />
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
