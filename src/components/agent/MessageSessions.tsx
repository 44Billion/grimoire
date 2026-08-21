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
import { Coins, Database, DollarSign, Gauge } from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { listSessionsForEvent, onAgentEvents } from "@/services/agent-store";
import type { SessionForEvent } from "@/services/agent-store";
import type { DecodedHead } from "@/lib/agent-session/types";
import { useAddWindow } from "@/core/state";
import { useAgentActivity } from "@/hooks/useAgentActivity";
import { UserName } from "@/components/nostr/UserName";
import { StatusDot, statusStyle } from "@/components/agent/status";
import { useLocale, formatExact, formatMoney } from "@/hooks/useLocale";
import { billedTokens, cacheRate } from "@/lib/agent-session/usage";
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
  contextWindow,
  onOpen,
}: {
  head: DecodedHead;
  contextWindow?: number;
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
      {/* `UserName` already flags a bot from its kind-0. A second robot beside
          it said the same thing twice, in a row with no space to spare. */}
      <UserName pubkey={head.session.agent} className="shrink-0 text-xs" />
      <span className={cn("truncate", style.text)}>
        {activity?.verb ?? style.label ?? head.status}
      </span>
      <SessionStats head={head} contextWindow={contextWindow} />
    </button>
  );
}

/**
 * What the run has spent, on the same line as what it is doing.
 *
 * Spend, tokens, cache, context — the same four figures in the same order as
 * the tiles in the session view, because they are the same four figures. They
 * used to be in-tokens, out-tokens, cache, spend, so a reader moving between
 * the two places had to re-find each number.
 *
 * Every figure is optional and none of it is invented: a head that carries no
 * usage renders nothing here rather than a row of zeroes, a session with no
 * cache reads does not claim a rate of nought, and context is absent unless the
 * run's own definition said how big its window was. Quiet by design — this sits
 * under a chat message and must not compete with it.
 */
function SessionStats({
  head,
  contextWindow,
}: {
  head: DecodedHead;
  contextWindow?: number;
}) {
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
  const tokens = billedTokens(usage);
  const cached = cacheRate(usage);
  const money = head.cost ? Number(head.cost.amount) : undefined;
  const filled =
    contextWindow && usage?.input ? usage.input / contextWindow : undefined;

  if (!usage && money === undefined) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 font-mono text-[10px] text-muted-foreground/70">
      {money !== undefined && money > 0 && (
        <span
          className="flex items-center gap-0.5"
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
      )}
      {tokens > 0 && (
        <span
          className="flex items-center gap-0.5"
          title={`${formatExact(usage!.input, locale)} in · ${formatExact(usage!.output, locale)} out`}
        >
          <Coins className="h-2.5 w-2.5" />
          {short.format(tokens)}
        </span>
      )}
      {cached !== undefined && cached > 0 && (
        <span
          className="flex items-center gap-0.5"
          title={`${formatExact(usage!.cacheRead, locale)} of ${formatExact(
            usage!.input,
            locale,
          )} input tokens served from cache`}
        >
          <Database className="h-2.5 w-2.5" />
          {Math.round(cached * 100)}%
        </span>
      )}
      {filled !== undefined && (
        <span
          className="flex items-center gap-0.5"
          title={`${formatExact(usage!.input, locale)} of a ${formatExact(
            contextWindow!,
            locale,
          )} token window`}
        >
          <Gauge className="h-2.5 w-2.5" />
          {Math.round(filled * 100)}%
        </span>
      )}
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
      {sessions.map(({ head, contextWindow }) => (
        <SessionRow
          key={`${head.session.agent}:${head.session.session}`}
          head={head}
          contextWindow={contextWindow}
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
