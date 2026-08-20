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

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Bot, Database } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { onDmScopes } from "@/services/dm-bus";
import { listSessionsForEvent } from "@/services/agent-store";
import type { DecodedHead } from "@/lib/agent-session/types";
import { useAddWindow } from "@/core/state";
import { useAgentActivity } from "@/hooks/useAgentActivity";
import { UserName } from "@/components/nostr/UserName";
import { StatusDot, statusStyle } from "@/components/agent/status";
import { useLocale, formatExact, formatMoney } from "@/hooks/useLocale";
import { cacheRate } from "@/lib/agent-session/usage";
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
      className="flex w-full max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50"
      title={head.title}
    >
      <StatusDot status={head.status} live={Boolean(activity)} />
      <UserName pubkey={head.session.agent} className="shrink-0 text-xs" />
      <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", style.text)}>
        {activity?.verb ?? style.label ?? head.status}
      </span>
      <SessionStats head={head} />
    </button>
  );
}

/**
 * What the run has spent, on the same line as what it is doing.
 *
 * Every figure is optional and none of it is invented: a head that carries no
 * usage renders nothing here rather than a row of zeroes, and a session with no
 * cache reads does not claim a rate of nought. Quiet by design — this sits under
 * a chat message and must not compete with it.
 */
function SessionStats({ head }: { head: DecodedHead }) {
  const { locale } = useLocale();

  const short = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [locale],
  );

  const usage = head.usage;
  const cached = cacheRate(usage);
  const money = head.cost ? Number(head.cost.amount) : undefined;

  if (!usage && money === undefined) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 font-mono text-[10px] text-muted-foreground/70">
      {usage && (usage.input > 0 || usage.output > 0) && (
        <>
          <span
            className="flex items-center gap-0.5"
            title={`${formatExact(usage.input, locale)} input tokens`}
          >
            <ArrowDownToLine className="h-2.5 w-2.5" />
            {short.format(usage.input)}
          </span>
          <span
            className="flex items-center gap-0.5"
            title={`${formatExact(usage.output, locale)} output tokens`}
          >
            <ArrowUpFromLine className="h-2.5 w-2.5" />
            {short.format(usage.output)}
          </span>
        </>
      )}
      {cached !== undefined && cached > 0 && (
        <span
          className="flex items-center gap-0.5"
          title={`${usage!.cacheRead.toLocaleString(locale)} of ${usage!.input.toLocaleString(
            locale,
          )} input tokens served from cache`}
        >
          <Database className="h-2.5 w-2.5" />
          {Math.round(cached * 100)}%
        </span>
      )}
      {money !== undefined && money > 0 && (
        <span
          title={
            head.cost?.estimated
              ? `About ${head.cost.amount} ${head.cost.currency} — worked out from token counts and list prices, not billed`
              : `${head.cost?.amount} ${head.cost?.currency}`
          }
        >
          {/* A tilde, because arithmetic is not a bill. */}
          {head.cost?.estimated ? "~" : ""}
          {formatMoney(money, head.cost?.currency ?? "USD", locale)}
        </span>
      )}
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
