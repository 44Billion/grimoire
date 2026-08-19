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
import { Bot } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { onDmScopes } from "@/services/dm-bus";
import { listSessionsForEvent } from "@/services/agent-store";
import type { DecodedHead } from "@/lib/agent-session/types";
import { useAddWindow } from "@/core/state";
import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";

/**
 * A status, as a coloured dot.
 *
 * The colours are grimoire's own tokens rather than picked hues, so a status
 * reads the same as everything else that means the same thing: `success` is
 * green and is what a run in progress uses, because to a reader a live agent is
 * a healthy one; `warning` is what needs them; `destructive` is what broke.
 *
 * A running session PULSES. That is the one status a reader looks at repeatedly,
 * and motion says "still going" without a word — while the word is still there
 * beside it, because a dot alone is a status you have to learn.
 */
const STATUS_STYLE: Record<
  string,
  { dot: string; text: string; label?: string; pulse?: boolean }
> = {
  active: {
    dot: "bg-success",
    text: "text-success",
    label: "running",
    pulse: true,
  },
  "awaiting-input": {
    dot: "bg-warning",
    text: "text-warning",
    label: "waiting for you",
    pulse: true,
  },
  idle: { dot: "bg-info", text: "text-info" },
  done: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  error: { dot: "bg-destructive", text: "text-destructive" },
  aborted: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

function StatusDot({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  };

  return (
    <span className="relative flex h-2 w-2 shrink-0" title={status}>
      {style.pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            style.dot,
          )}
        />
      )}
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", style.dot)}
      />
    </span>
  );
}

export function MessageSessions({ messageId }: { messageId: string }) {
  const { pubkey } = useAccount();
  const addWindow = useAddWindow();
  const [sessions, setSessions] = useState<DecodedHead[]>([]);

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
    const off = onDmScopes(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [pubkey, messageId]);

  if (sessions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {sessions.map((head) => (
        <button
          key={`${head.session.agent}:${head.session.session}`}
          type="button"
          onClick={() =>
            addWindow("agent", {
              agent: head.session.agent,
              session: head.session.session,
            })
          }
          className="flex w-fit max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50"
          title={head.title}
        >
          <StatusDot status={head.status} />
          <UserName pubkey={head.session.agent} className="shrink-0 text-xs" />
          <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "shrink-0",
              (STATUS_STYLE[head.status] ?? { text: "text-muted-foreground" })
                .text,
            )}
          >
            {STATUS_STYLE[head.status]?.label ?? head.status}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {head.lastSeq} {head.lastSeq === 1 ? "turn" : "turns"}
          </span>
        </button>
      ))}
    </div>
  );
}
