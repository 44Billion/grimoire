/**
 * What came of a message: who answered, and what it set running — one row.
 *
 * They used to be two, one under the other, and they were describing one thing
 * from two ends. An agent run under a message is usually what produced the
 * replies under it, so a reader deciding whether to open anything was reading two
 * lines to answer one question.
 *
 *     ● Hex, verbiricha replied · running npm test      $ US$0.18   ⌸ 3
 *
 * **The marker is the indicator.** Colour and pulse carry the run's state — green
 * going, amber wants you, red stopped badly, grey over — which is what
 * `StatusDot` exists for and is the same dot the session view uses. So the WORD
 * is only spent when it adds something the colour cannot: a live verb off the
 * delta stream ("running npm test"), or a state that wants a person. An `idle`
 * beside a grey dot is the dot again, in eight characters.
 *
 * **Several agents in one message is the case this is built for**, not an edge of
 * it. Tag three and the row grows three dots, one per run, each in its own
 * colour — a single dot for the "most interesting" one would sit green while
 * another underneath waited for the reader. The figure on the right is the TOTAL
 * spend with a per-run breakdown in its tooltip, because one run's cost on a row
 * that speaks for three is a number that looks complete and is not. Beyond three
 * runs the dots become `+n`.
 *
 * **Who the row names depends on what is happening.** A run that is doing
 * something and has not answered yet gets it — "Hex thinking" is the live fact
 * and it is about to change, while the people who replied will still be named in
 * an hour. Once that agent has replied it is simply one of the names, and the row
 * goes back to saying who answered.
 *
 * Clicking opens the PANE whenever there is more than one thing under the
 * message — replies, or several runs — since the pane lists every run and every
 * reply, and a click that silently picked one would hide the others. A single run
 * with no replies goes straight to its transcript. So merging costs no
 * reachability.
 */

import { useMemo } from "react";
import { MessageSquare } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";
import { StatusDot, statusStyle } from "@/components/agent/status";
import { SessionSpend } from "@/components/agent/SessionSpend";
import { useAgentActivity } from "@/hooks/useAgentActivity";
import { useSessionsForEvent } from "@/hooks/useSessionsForEvent";
import type { DecodedHead } from "@/lib/agent-session/types";
import type { ThreadSummary } from "@/lib/chat/threads";

/** How many names are spelled out before the rest become a `+n`. */
const NAMED = 2;

/** How many runs get a dot of their own before the rest become a `+n`. */
const DOTTED = 3;

/**
 * The two states worth spending a word on: something is wanted from a person.
 *
 * Everything else the colour carries alone. `idle`, `done`, `stopped` and
 * `error` are all OVER — nothing is going to change and nothing is being asked —
 * so the word only repeated the dot in eight characters on a line that has none
 * to spare. Live runs get a verb anyway, from the delta stream, and it says far
 * more than `active` ever did. The dot's tooltip still names the raw status for
 * anyone who wants it.
 */
const VERB_WORTHY = new Set(["awaiting-input", "payment-required"]);

/**
 * The run this row speaks for, when a message started more than one.
 *
 * The one that wants attention, else the one that is still going, else the
 * newest. A row that showed the first-listed run could sit grey while another
 * under the same message was waiting for the reader.
 */
function leadSession(heads: DecodedHead[]): DecodedHead | undefined {
  return (
    heads.find((h) => VERB_WORTHY.has(h.status)) ??
    heads.find((h) => h.status === "active") ??
    heads[0]
  );
}

export function MessageActivity({
  messageId,
  thread,
  unread,
  active,
  onOpenThread,
  onCloseThread,
  onOpenSession,
}: {
  messageId: string;
  /** The replies folded under this message, when it has any. */
  thread?: ThreadSummary;
  /** How many of those the reader has not seen. */
  unread?: number;
  /** Whether the pane is already showing this message's thread. */
  active?: boolean;
  onOpenThread?: (rootId: string) => void;
  /** Closes it again — this row is the toggle for the pane it opened. */
  onCloseThread?: () => void;
  onOpenSession?: (agent: string, session: string) => void;
}) {
  const sessions = useSessionsForEvent(messageId);
  const heads = useMemo(() => sessions.map((s) => s.head), [sessions]);
  const lead = leadSession(heads);
  // Safe with an absent session: the hook takes undefined and subscribes to
  // nothing. Called unconditionally, which is the rule it has to satisfy.
  const activity = useAgentActivity(
    lead?.session.agent,
    lead?.session.session,
    lead?.deltaRelays,
  );

  const replied = thread ? thread.repliers : [];
  const style = lead ? statusStyle(lead.status) : undefined;
  // With several runs wanting a person at once, the count IS the message: one
  // agent's label would name one of them and quietly drop the others.
  const wanting = heads.filter((h) => VERB_WORTHY.has(h.status)).length;
  const verb =
    wanting > 1
      ? `${wanting} need you`
      : lead && (activity || VERB_WORTHY.has(lead.status))
        ? (activity?.verb ?? style?.label ?? lead.status)
        : undefined;

  /**
   * An agent that is doing something and has not answered yet gets the row.
   *
   * "Hex thinking" is the live fact and it is about to change; the people who
   * replied are named on a row that will still be there in an hour. So when the
   * running agent is NOT among the repliers, it speaks and the reply count on the
   * right carries the rest. Once it has replied it is one of the names, and the
   * row goes back to saying who answered.
   */
  const speaksForRun =
    !!verb && !!lead && !replied.includes(lead.session.agent);

  // Naming the agent when nobody replied is not "replied" — that would claim a
  // message that does not exist.
  const names = speaksForRun
    ? [lead.session.agent]
    : replied.length > 0
      ? replied
      : lead
        ? [lead.session.agent]
        : [];
  if (names.length === 0) return null;

  const named = names.slice(0, NAMED);
  const rest = names.length - named.length;
  const saysReplied = !speaksForRun && replied.length > 0;

  /**
   * Where the row goes.
   *
   * The pane whenever there is more than one thing under this message — replies,
   * or several runs — because the pane is the only place that lists them all and
   * a click that picked one silently would hide the rest. Straight to the
   * transcript only when a single run is the whole of it.
   */
  const onClick = () => {
    // A TOGGLE when the pane is already showing this one. The pane's own close
    // sits directly under the window's close in the same column, one row apart,
    // and a reader aiming for one and hitting the other loses the whole window.
    // The row they opened it from is the unmissable way back.
    if (active && onCloseThread) return onCloseThread();
    if (thread && onOpenThread) onOpenThread(thread.rootId);
    else if (heads.length > 1 && onOpenThread) onOpenThread(messageId);
    else if (lead && onOpenSession)
      onOpenSession(lead.session.agent, lead.session.session);
  };

  const title = [
    thread
      ? `${thread.replyIds.length} ${thread.replyIds.length === 1 ? "reply" : "replies"}${unread ? `, ${unread} unread` : ""}`
      : undefined,
    lead ? `session ${lead.status}` : undefined,
    sessions.length > 1 ? `${sessions.length} sessions` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-expanded={thread ? active : undefined}
      // Fixed height and no wrapping: this grows under a message already on
      // screen, so a row that changed height when a name or a figure arrived
      // would shift the timeline under the reader.
      className={cn(
        "mt-1 flex h-5 w-full max-w-full items-center gap-1.5 whitespace-nowrap rounded px-1 text-left text-xs hover:bg-muted/50",
        active && "bg-muted/50",
      )}
    >
      {heads.length > 0 ? (
        // ONE DOT PER RUN, capped. Several agents can be tagged in the same
        // message, and a single dot for the "most interesting" one would sit
        // green while another under it waited for the reader. Only the lead's
        // pulses from the live delta stream; the rest pulse from their own head
        // status, which is what it is for.
        <span className="flex shrink-0 items-center gap-1">
          {heads.slice(0, DOTTED).map((head) => (
            <StatusDot
              key={`${head.session.agent}:${head.session.session}`}
              status={head.status}
              live={head === lead && Boolean(activity)}
            />
          ))}
          {heads.length > DOTTED && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              +{heads.length - DOTTED}
            </span>
          )}
        </span>
      ) : (
        // No run: the same 8px box, hollow. Deliberately not a coloured dot,
        // which here would claim a session status this message has none of.
        <span className="flex h-2 w-2 shrink-0 items-center justify-center">
          <span
            className={cn(
              "h-2 w-2 rounded-full border",
              unread
                ? "border-primary bg-primary/30"
                : "border-muted-foreground",
            )}
          />
        </span>
      )}
      {/* `UserName`, not a flat string: it carries the bot marker, custom emoji
          in a display name, and the member and supporter badges — the same name
          the message above it draws. A span with its own stopPropagation, so it
          opens a profile without also opening the thread, and no interactive
          element nests inside this button. */}
      <span className="flex min-w-0 items-center gap-1 truncate">
        {named.map((pubkey, index) => (
          <span key={pubkey} className="flex min-w-0 items-center">
            <UserName pubkey={pubkey} className="text-xs" />
            {index < named.length - 1 && ","}
          </span>
        ))}
        {rest > 0 && (
          <span className="shrink-0 text-muted-foreground">+{rest}</span>
        )}
      </span>
      {saysReplied && (
        <span className="shrink-0 text-muted-foreground">replied</span>
      )}
      {verb && (
        <span className={cn("truncate", style?.text)}>
          {saysReplied ? `· ${verb}` : verb}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        {heads.length > 0 && <SessionSpend heads={heads} />}
        {thread && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 font-mono text-[10px]",
              unread ? "text-primary" : "text-muted-foreground/70",
            )}
          >
            <MessageSquare className="h-2.5 w-2.5" />
            {thread.replyIds.length}
          </span>
        )}
      </span>
    </button>
  );
}
