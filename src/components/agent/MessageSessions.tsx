/**
 * The agent sessions a message set running, listed under it.
 *
 * A session's head names the event that caused the run, so this is the question
 * asked from the other end: what did this message start? That direction is the
 * whole point — an agent does not have to reply, or carry a pointer in its answer,
 * for a reader to find the work. It publishes a transcript that says which message
 * it came from, and the conversation grows a row.
 *
 * Live, because a run in progress is exactly when this is worth looking at: the
 * status moves `active` → `awaiting-input` → `idle`, the turn count climbs, and
 * both come off the local mirror through the same doorbell every other pane uses.
 * There is no subscription here.
 *
 * Renders NOTHING when there are no sessions, which is almost every message in
 * almost every conversation.
 */

import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { listSessionsForEvent, onAgentEvents } from "@/services/agent-store";
import type { SessionForEvent } from "@/services/agent-store";
import type { DecodedHead } from "@/lib/agent-session/types";
import { useAddWindow } from "@/core/state";
import { useAgentActivity } from "@/hooks/useAgentActivity";
import { UserName } from "@/components/nostr/UserName";
import { StatusDot, statusStyle } from "@/components/agent/status";
import { useLocale, formatMoney } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

/**
 * One session's row.
 *
 * A component of its own because the live verb is per session: the row watches
 * the delta stream for its own address and says what the agent is doing, falling
 * back to the head's status when nothing has arrived lately. `active` for ninety
 * seconds tells a reader nothing; `running npm test` tells them everything.
 */
function SessionRow({
  head,
  onOpen,
}: {
  head: DecodedHead;
  onOpen: () => void;
}) {
  const activity = useAgentActivity(
    head.session.agent,
    head.session.session,
    head.deltaRelays,
  );
  const style = statusStyle(head.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      // Fixed height, and the thread row under it matches: both grow under a
      // message already on screen, and a row that changes height when a figure
      // or a name arrives shifts the timeline under the reader.
      className="flex h-5 w-full max-w-full items-center gap-1.5 whitespace-nowrap rounded px-1 text-left text-xs hover:bg-muted/50"
      title={head.title}
    >
      <StatusDot status={head.status} live={Boolean(activity)} />
      {/* `UserName` already flags a bot from its kind-0. A second robot beside
          it said the same thing twice, in a row with no space to spare. */}
      <UserName pubkey={head.session.agent} className="shrink-0 text-xs" />
      <span className={cn("truncate", style.text)}>
        {activity?.verb ?? style.label ?? head.status}
      </span>
      <SessionSpend head={head} />
    </button>
  );
}

/**
 * What the run has spent — and nothing else, on this row.
 *
 * It used to carry spend, tokens, cache and context, the same four figures as
 * the tiles in the session view. Four is right in the session view, where they
 * are the subject; under a chat message they are four things to read on a line
 * whose job is to say an agent did something, and they crowded out the row that
 * sits beside them saying who replied. The other three are one click away, in
 * the transcript, where they are laid out to be compared.
 *
 * Spend earns its place because it is the one figure that is not recoverable by
 * looking: a reader scanning a channel wants to know what the runs cost, not how
 * full a context window got.
 *
 * Still invented from nothing: a head carrying no cost renders nothing rather
 * than a zero, and the tilde says when arithmetic is standing in for a bill.
 */
function SessionSpend({ head }: { head: DecodedHead }) {
  const { locale } = useLocale();
  const money = head.cost ? Number(head.cost.amount) : undefined;
  if (money === undefined || money <= 0) return null;

  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-0.5 pl-2 font-mono text-[10px] text-muted-foreground/70"
      title={
        head.cost?.estimated
          ? `About ${head.cost.amount} ${head.cost.currency} — worked out from token counts and list prices, not billed`
          : `${head.cost?.amount} ${head.cost?.currency}`
      }
    >
      <DollarSign className="h-2.5 w-2.5" />
      {/* A tilde, because arithmetic is not a bill. */}
      {head.cost?.estimated ? "~" : ""}
      {formatMoney(money, head.cost?.currency ?? "USD", locale)}
    </span>
  );
}

export function MessageSessions({ messageId }: { messageId: string }) {
  const { pubkey } = useAccount();
  const addWindow = useAddWindow();
  const [sessions, setSessions] = useState<SessionForEvent[]>([]);

  useEffect(() => {
    if (!pubkey || !messageId) return;
    let live = true;
    const read = async () => {
      const next = await listSessionsForEvent(pubkey, messageId);
      if (live) setSessions(next);
    };
    void read();
    // A rumor is written to Dexie before the doorbell rings, so re-reading on any
    // ring is enough: a missed ring costs a stale row, never a lost session.
    const off = onAgentEvents(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [pubkey, messageId]);

  if (sessions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {sessions.map(({ head }) => (
        <SessionRow
          key={`${head.session.agent}:${head.session.session}`}
          head={head}
          onOpen={() =>
            addWindow("agent", {
              agent: head.session.agent,
              session: head.session.session,
            })
          }
        />
      ))}
    </div>
  );
}
