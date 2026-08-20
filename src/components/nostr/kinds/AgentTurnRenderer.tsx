import { useMemo } from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

import type { NostrEvent } from "@/types/nostr";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { isKnownPart } from "@/lib/agent-session/types";
import type { DecodedTurn, TurnPart } from "@/lib/agent-session/types";
import { Check, Users } from "lucide-react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { CollapsibleContent } from "@/components/ui/collapsible";
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
import {
  formatCompact,
  formatExact,
  formatMoney,
  useLocale,
} from "@/hooks/useLocale";
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
      {/*
        The trace VERBATIM, not through a markdown renderer.
        A thought is not a document: it is written for nobody, so a stray `#`
        at the start of a line is a note to self and not a heading, and running
        it through Streamdown blew those up to heading size and ate the line
        breaks that made it readable. `whitespace-pre-wrap` at `text-xs` is what
        it looked like before, and before was right.
      */}
      <CollapsibleContent className="mt-1 border-l-2 border-border pl-3 text-xs whitespace-pre-wrap text-muted-foreground">
        {text}
      </CollapsibleContent>
    </Reasoning>
  );
}

/**
 * A bech32 entity, with or without the `nostr:` scheme in front of it.
 *
 * Deliberately generous about the scheme: a model asked for "an nevent" writes
 * one about as often with the prefix as without, and both name the same thing.
 */
const NOSTR_ENTITY =
  /(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]{20,}/i;

/**
 * What the model wrote, read by whichever renderer the paragraph needs.
 *
 * A model writes markdown, so the default is the same renderer the `ai` window
 * uses — a transcript full of literal asterisks is the failure that avoids. But
 * a model working on Nostr also writes Nostr: it answers "list the issues" with
 * five `nevent1…`, which markdown renders as five hundred characters of base32
 * and grimoire has rendered as the events themselves everywhere else since
 * before any of this existed.
 *
 * So the split is per PARAGRAPH rather than per document. A paragraph naming an
 * entity goes to `RichText`, which turns it into the person or the note; every
 * other paragraph keeps its markdown. Paragraphs, because that is the unit a
 * model puts one reference on a line of — and because splitting inside one
 * would break a list in half.
 */
function AssistantText({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const paragraphs = text.split(/\n{2,}/);
    // One block per run of same-kind paragraphs, so consecutive markdown stays
    // one document and keeps its lists and headings intact.
    const grouped: { nostr: boolean; text: string }[] = [];
    for (const paragraph of paragraphs) {
      const nostr = NOSTR_ENTITY.test(paragraph);
      const last = grouped[grouped.length - 1];
      if (last && last.nostr === nostr) last.text += `\n\n${paragraph}`;
      else grouped.push({ nostr, text: paragraph });
    }
    return grouped;
  }, [text]);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, at) =>
        block.nostr ? (
          <RichText key={at} content={block.text} className="text-sm" />
        ) : (
          /* `text-sm`, like the question above it and like every event body in
             grimoire. Markdown's base size made the reply the largest text on
             screen, which reads as a different application. */
          <MessageResponse key={at} className="max-w-full break-words text-sm">
            {block.text}
          </MessageResponse>
        ),
      )}
    </div>
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
        <AssistantText text={part.text} />
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
  const { locale } = useLocale();
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
            {/*
              No bot marker. It was there to say the agent side is a machine,
              which in a window called AGENT, reading a transcript published BY
              an agent, under a heading naming it, is the fourth time. `UserName`
              already wears one when the profile declares `bot`.
            */}
            <UserName pubkey={block.speaker} />
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
                  title={`${formatExact(totals.input, locale)} input tokens`}
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  {formatCompact(totals.input, locale)}
                </span>
                <span
                  className="flex items-center gap-0.5"
                  title={`${formatExact(totals.output, locale)} output tokens`}
                >
                  <ArrowUpFromLine className="h-3 w-3" />
                  {formatCompact(totals.output, locale)}
                </span>
              </>
            )}
            {totals.cost && (
              <span
                title={`What this block cost: ${totals.cost.amount} ${totals.cost.currency}`}
              >
                {formatMoney(
                  Number(totals.cost.amount),
                  totals.cost.currency,
                  locale,
                )}
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
