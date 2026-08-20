/**
 * The four numbers, in the four places they are asked for.
 *
 * Lifted from fragua's control centre, which settled this already: how much
 * work, what it cost, how many tokens, how much of it came from cache. One
 * component so the dashboard's strip and a session's header cannot drift into
 * disagreeing about what "tokens" means — which is exactly what happened to
 * fragua when four surfaces each inlined the arithmetic.
 *
 * The first tile is the only one that differs by scope: across every agent it
 * counts RUNS, and inside one run it counts TURNS. Everything else is the same
 * question asked of a smaller set.
 */

import type { ReactNode } from "react";
import {
  Coins,
  Database,
  DollarSign,
  MessagesSquare,
  Play,
} from "lucide-react";

import {
  formatCompact,
  formatExact,
  formatMoney,
  useLocale,
} from "@/hooks/useLocale";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { billedTokens, cacheRate } from "@/lib/agent-session/usage";
import type { Usage } from "@/lib/agent-session/types";

export interface StatsInput {
  usage: Usage | undefined;
  /** Total spend, already summed. */
  spend: number;
  currency: string;
  /** True when any part of the spend was worked out rather than billed. */
  estimated?: boolean;
  /** Runs across a dashboard, turns inside a session. */
  count: number;
}

export function StatStrip({
  stats,
  countLabel,
  context,
}: {
  stats: StatsInput;
  /** `runs` on a dashboard, `turns` in a session. */
  countLabel: "runs" | "turns";
  /**
   * How much of the model's window this run is using, when it is knowable.
   *
   * Only a session has one — a dashboard sums runs on different models with
   * different windows, and a percentage of that is not a number. Absent when
   * the agent published no window: how full is 32k depends entirely on whether
   * the ceiling is 200k or a million, so a bar with a guessed maximum is worse
   * than no bar.
   */
  context?: { usedTokens: number; maxTokens: number; modelId?: string };
}) {
  const { locale } = useLocale();
  const tokens = billedTokens(stats.usage);
  const rate = cacheRate(stats.usage);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile
        icon={
          countLabel === "runs" ? (
            <Play className="size-3.5" />
          ) : (
            <MessagesSquare className="size-3.5" />
          )
        }
        label={countLabel}
        value={formatCompact(stats.count, locale)}
      />
      <Tile
        icon={<DollarSign className="size-3.5" />}
        label={stats.estimated ? "spend (est.)" : "spend"}
        value={
          stats.spend > 0
            ? formatMoney(stats.spend, stats.currency, locale)
            : "—"
        }
        hint={
          stats.estimated
            ? "At least one figure was worked out from token counts and list prices rather than billed"
            : undefined
        }
      />
      <Tile
        icon={<Coins className="size-3.5" />}
        label="tokens"
        value={tokens > 0 ? formatCompact(tokens, locale) : "—"}
        hint={
          stats.usage
            ? `${formatExact(stats.usage.input, locale)} in · ${formatExact(stats.usage.output, locale)} out`
            : undefined
        }
      />
      {context && context.maxTokens > 0 ? (
        <Context
          maxTokens={context.maxTokens}
          modelId={context.modelId}
          usage={{
            inputTokens: stats.usage?.input,
            outputTokens: stats.usage?.output,
            cachedInputTokens: stats.usage?.cacheRead,
          }}
          usedTokens={context.usedTokens}
        >
          <div className="flex flex-col gap-1.5 rounded border border-border p-2">
            <span className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
              <Database className="size-3.5" />
              context
            </span>
            <ContextTrigger className="h-auto w-fit p-0 font-mono text-lg leading-none tabular-nums hover:bg-transparent" />
          </div>
          <ContextContent>
            <ContextContentHeader />
            <ContextContentBody>
              <div className="flex flex-col gap-1">
                <ContextInputUsage />
                <ContextOutputUsage />
                <ContextCacheUsage />
                <ContextReasoningUsage />
              </div>
            </ContextContentBody>
            <ContextContentFooter />
          </ContextContent>
        </Context>
      ) : (
        <Tile
          icon={<Database className="size-3.5" />}
          label="cache"
          value={rate === undefined ? "—" : `${Math.round(rate * 100)}%`}
          hint={
            stats.usage && rate !== undefined
              ? `${formatExact(stats.usage.cacheRead, locale)} of ${formatExact(stats.usage.input, locale)} input tokens came from cache`
              : undefined
          }
        />
      )}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      // `gap-1.5`: at `gap-0.5` the uppercase label sat on the figure's
      // shoulders and the pair read as one smudge rather than as a caption
      // above a number.
      className="flex flex-col gap-1.5 rounded border border-border p-2"
      title={hint}
    >
      <span className="flex items-center gap-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        {icon}
        {label}
      </span>
      {/* Tabular, so a column of these lines up rather than shimmying as
          digits change under a live run. */}
      <span className="font-mono text-lg leading-none tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** Fold a set of session heads into one strip's worth of numbers. */
export function summariseHeads(
  heads: {
    usage?: Usage;
    cost?: { amount: string; currency: string; estimated?: boolean };
  }[],
): Omit<StatsInput, "count"> {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let spend = 0;
  let estimated = false;
  let currency = "USD";

  for (const head of heads) {
    input += head.usage?.input ?? 0;
    output += head.usage?.output ?? 0;
    cacheRead += head.usage?.cacheRead ?? 0;
    cacheWrite += head.usage?.cacheWrite ?? 0;
    const amount = Number(head.cost?.amount);
    if (Number.isFinite(amount)) spend += amount;
    // One estimated figure makes the total an estimate. A mixed sum presented
    // as a bill is worse than one presented as arithmetic.
    if (head.cost?.estimated) estimated = true;
    if (head.cost?.currency) currency = head.cost.currency;
  }

  return {
    usage: { input, output, cacheRead, cacheWrite },
    spend,
    currency,
    estimated,
  };
}
