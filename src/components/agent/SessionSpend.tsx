/**
 * What a run has spent, as one figure on a one-line row.
 *
 * It used to carry spend, tokens, cache and context — the same four figures as
 * the tiles in the session view. Four is right there, where they are the subject
 * and laid out to be compared; on a row under a chat message they were four
 * things to read on a line whose job is to say an agent did something. The other
 * three are one click away in the transcript.
 *
 * Spend stays because it is the one figure a reader cannot recover by looking.
 *
 * Nothing is invented: a head carrying no cost renders nothing rather than a
 * zero, and the tilde says when arithmetic is standing in for a bill.
 */

import { DollarSign } from "lucide-react";

import { useLocale, formatMoney } from "@/hooks/useLocale";
import type { DecodedHead } from "@/lib/agent-session/types";

/**
 * One figure for however many runs a message started.
 *
 * Several agents can be tagged in the same message, and the row that speaks for
 * them has space for one number — so it is the TOTAL, and the tooltip breaks it
 * down per run. Showing one run's spend while three had been paid for would be
 * the worst of the options: a number that looks complete and is not.
 *
 * Only runs sharing the leading currency are summed. Mixing currencies into one
 * figure invents an exchange rate; the odd one out is named in the tooltip and
 * left out of the arithmetic.
 */
export function SessionSpend({ heads }: { heads: DecodedHead[] }) {
  const { locale } = useLocale();

  const priced = heads.filter((h) => h.cost && Number(h.cost.amount) > 0);
  if (priced.length === 0) return null;

  const currency = priced[0].cost!.currency ?? "USD";
  const counted = priced.filter(
    (h) => (h.cost!.currency ?? "USD") === currency,
  );
  const total = counted.reduce((sum, h) => sum + Number(h.cost!.amount), 0);
  const estimated = counted.some((h) => h.cost!.estimated);

  const lines = priced.map((h) => {
    const amount = `${h.cost!.estimated ? "about " : ""}${h.cost!.amount} ${h.cost!.currency ?? "USD"}`;
    return priced.length > 1 ? `${h.title ?? h.status}: ${amount}` : amount;
  });
  if (estimated) {
    lines.push(
      "Amounts marked ~ are worked out from token counts and list prices, not billed",
    );
  }

  return (
    <span
      className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground/70"
      title={lines.join("\n")}
    >
      <DollarSign className="h-2.5 w-2.5" />
      {/* A tilde, because arithmetic is not a bill. */}
      {estimated ? "~" : ""}
      {formatMoney(total, currency, locale)}
    </span>
  );
}
