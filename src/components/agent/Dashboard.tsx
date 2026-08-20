/**
 * What the agents need from you, and what they are doing — before you pick one.
 *
 * The window's empty state used to be "Pick a session to read its transcript",
 * which answers a question nobody has yet. The question someone opening this
 * actually has is "is anything waiting on me", and the honest order for
 * answering it runs by urgency, not by recency:
 *
 *   1. Totals      — what all of this is costing and how much is in flight
 *   2. Agents      — who is here, and how busy
 *   3. Inbox       — runs BLOCKED on a person, oldest first
 *   4. Running     — what is executing right now
 *   5. Recent      — everything else, newest first
 *
 * The shape is fragua's control centre, and the reasoning is the same: an
 * archive is a different mode from a watchtower, so browsing every past run
 * lives in the list beside this, not here.
 *
 * The inbox is oldest-first on purpose, where every other list is newest-first.
 * A blocked run is a person waiting, and the one that has been waiting longest
 * is the one most likely to have been forgotten — newest-first would bury it
 * exactly as it becomes urgent.
 */

import { useMemo } from "react";
import { Bot, CircleHelp, Play, Wallet } from "lucide-react";

import { StatusBadge, StatusDot } from "@/components/agent/status";
import { UserName } from "@/components/nostr/UserName";
import Timestamp from "@/components/Timestamp";
import {
  formatCompact,
  formatExact,
  formatMoney,
  useLocale,
} from "@/hooks/useLocale";
import { cacheRate } from "@/lib/agent-session/usage";
import type { DecodedHead } from "@/lib/agent-session/types";
import { cn } from "@/lib/utils";

/** Statuses that mean a person, not a machine, is the hold-up. */
const BLOCKED_STATUSES = ["awaiting-input", "payment-required"] as const;

const isBlocked = (head: DecodedHead) =>
  (BLOCKED_STATUSES as readonly string[]).includes(head.status);

/** How many rows a section shows before it stops and says how many it hid. */
const SECTION_LIMIT = 6;

export function AgentDashboard({
  sessions,
  onSelect,
  onOpenAgent,
}: {
  sessions: DecodedHead[];
  onSelect: (next: { agent: string; session: string }) => void;
  onOpenAgent: (agent: string) => void;
}) {
  const { locale } = useLocale();

  const summary = useMemo(() => {
    let input = 0;
    let output = 0;
    let cached = 0;
    let spend = 0;
    let estimated = false;

    for (const head of sessions) {
      if (head.usage) {
        input += head.usage.input;
        output += head.usage.output;
        cached += head.usage.cacheRead;
      }
      if (head.cost) {
        const amount = Number(head.cost.amount);
        if (Number.isFinite(amount)) spend += amount;
        // One estimated figure makes the total an estimate. Presenting a mixed
        // sum as a bill is worse than presenting no figure at all.
        if (head.cost.estimated) estimated = true;
      }
    }

    const blocked = sessions
      .filter(isBlocked)
      .sort((a, b) => a.started - b.started);
    const running = sessions
      .filter((head) => head.status === "active")
      .sort((a, b) => b.started - a.started);
    const recent = [...sessions].sort((a, b) => b.started - a.started);

    const agents = new Map<string, { total: number; live: number }>();
    for (const head of sessions) {
      const at = agents.get(head.session.agent) ?? { total: 0, live: 0 };
      at.total += 1;
      // Running, not merely unfinished. `idle` is a session waiting for its
      // next message, which is nothing happening.
      if (head.status === "active") at.live += 1;
      agents.set(head.session.agent, at);
    }

    return {
      usage: { input, output, cacheRead: cached, cacheWrite: 0 },
      spend,
      estimated,
      blocked,
      running,
      recent,
      agents: [...agents.entries()].sort(
        ([, a], [, b]) => b.live - a.live || b.total - a.total,
      ),
    };
  }, [sessions]);

  if (sessions.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          No agent sessions yet. An agent publishes what it did to your inbox as
          gift wraps — nothing here talks to a relay of its own.
        </p>
      </div>
    );

  const rate = cacheRate(summary.usage);

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          icon={Play}
          label="running"
          value={String(summary.running.length)}
          tone={summary.running.length > 0 ? "success" : undefined}
        />
        <Tile
          icon={CircleHelp}
          label="waiting on you"
          value={String(summary.blocked.length)}
          tone={summary.blocked.length > 0 ? "warning" : undefined}
        />
        <Tile
          icon={Wallet}
          label={summary.estimated ? "spent (est.)" : "spent"}
          value={
            summary.spend > 0 ? formatMoney(summary.spend, "USD", locale) : "—"
          }
          title={
            summary.estimated
              ? "At least one session's cost was computed from a price list rather than billed, so this total is an estimate"
              : undefined
          }
        />
        <Tile
          icon={Bot}
          label="tokens"
          value={`${formatCompact(summary.usage.input, locale)} / ${formatCompact(summary.usage.output, locale)}`}
          title={
            rate === undefined
              ? `${formatExact(summary.usage.input, locale)} input / ${formatExact(summary.usage.output, locale)} output across every session`
              : `${formatExact(summary.usage.input, locale)} input / ${formatExact(summary.usage.output, locale)} output — ${Math.round(rate * 100)}% of input came from cache`
          }
        />
      </section>

      <Section title="Agents">
        {/*
          Full-width rows, not pills.
          Bordered chips in a wrapping row read as tags — decoration you look
          past — when each one is the main thing on this screen you can open.
          A row you can click along its whole length says so.
        */}
        <div className="flex flex-col">
          {summary.agents.map(([agent, counts]) => (
            <button
              key={agent}
              type="button"
              onClick={() => onOpenAgent(agent)}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/50"
            >
              <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
              <UserName pubkey={agent} className="truncate" />
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {/*
                  "live" only when something is actually running. An idle
                  session is one nobody is waiting on — counting it as live
                  made a window of finished work look busy.
                */}
                {counts.live > 0 && (
                  <span className="text-success">{counts.live} live · </span>
                )}
                {counts.total} session{counts.total === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {summary.blocked.length > 0 && (
        <Section
          title="Waiting on you"
          hint="oldest first — the one that has been waiting longest is the one most likely forgotten"
        >
          <Rows heads={summary.blocked} onSelect={onSelect} showQuestion />
        </Section>
      )}

      {summary.running.length > 0 && (
        <Section title="Running">
          <Rows heads={summary.running} onSelect={onSelect} />
        </Section>
      )}

      <Section title="Recent">
        <Rows heads={summary.recent} onSelect={onSelect} showAgent />
      </Section>
    </div>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
  title,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  tone?: "success" | "warning";
  title?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded border border-dotted border-border p-2"
      title={title}
    >
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-lg leading-none",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-baseline gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
        {hint && (
          <span className="truncate text-[10px] normal-case tracking-normal opacity-70">
            {hint}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Rows({
  heads,
  onSelect,
  showAgent,
  showQuestion,
}: {
  heads: DecodedHead[];
  onSelect: (next: { agent: string; session: string }) => void;
  showAgent?: boolean;
  showQuestion?: boolean;
}) {
  const shown = heads.slice(0, SECTION_LIMIT);
  const hidden = heads.length - shown.length;

  return (
    <div className="flex flex-col">
      {shown.map((head) => (
        <button
          key={`${head.session.agent}:${head.session.session}`}
          type="button"
          onClick={() =>
            onSelect({
              agent: head.session.agent,
              session: head.session.session,
            })
          }
          className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/50"
        >
          <StatusDot status={head.status} live={head.status === "active"} />
          <span className="truncate">{head.title || "untitled session"}</span>
          {/* What it is actually blocked on, when there is one — a row that
              says "waiting" without saying for what is a row you have to open
              to learn anything from. */}
          {showQuestion && head.pending.length > 0 && (
            <span className="shrink-0 text-[11px] text-warning">
              {head.pending.length} question
              {head.pending.length === 1 ? "" : "s"}
            </span>
          )}
          {showAgent && (
            <UserName
              pubkey={head.session.agent}
              className="ml-auto max-w-[30%] shrink-0 truncate text-[11px] text-muted-foreground"
            />
          )}
          <span
            className={cn(
              "shrink-0 text-[11px] text-muted-foreground",
              !showAgent && "ml-auto",
            )}
          >
            <Timestamp timestamp={head.started} />
          </span>
        </button>
      ))}
      {hidden > 0 && (
        // Said, not silently dropped: a list that stops without saying so reads
        // as a complete list that happens to be short.
        <span className="px-1 py-1 text-[11px] text-muted-foreground">
          and {hidden} more in the list
        </span>
      )}
    </div>
  );
}

export { StatusBadge };
