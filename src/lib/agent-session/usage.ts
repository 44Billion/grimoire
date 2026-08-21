/**
 * Reading a usage record, the same way everywhere.
 *
 * These figures are shown in three places and were computed in two, which is one
 * more than the number of correct answers. The share served from cache in
 * particular has an easy wrong version: `cacheRead` is a SUBSET of `input` — Eve
 * fills it from `inputTokenDetails.cacheReadTokens`, checked against the package
 * rather than assumed — so dividing by `input + cacheRead` counts the cached
 * tokens twice and always reads low.
 */

import type { Usage } from "./types";

/**
 * What share of the prompt was served from cache, 0–1, or nothing.
 *
 * Nothing when there is no input or nothing was cached: a session that read no
 * cache has no rate, and "0%" invites a reader to wonder what went wrong.
 */
/**
 * Total tokens billed for a run.
 *
 * `input + output`, and `cacheRead` is deliberately NOT added: in what an agent
 * publishes here the cached tokens are counted INSIDE `input` — the
 * OpenAI/Google convention — so adding them again would inflate every total by
 * however well the cache happened to be working.
 *
 * fragua's equivalent does add them, correctly, because its buckets are
 * disjoint. Same word, different data; copying its arithmetic would have been
 * the plausible wrong answer.
 */
export function billedTokens(usage: Usage | undefined): number {
  if (!usage) return 0;
  return usage.input + usage.output;
}

export function cacheRate(usage: Usage | undefined): number | undefined {
  if (!usage || usage.input <= 0 || usage.cacheRead <= 0) return undefined;
  return usage.cacheRead / usage.input;
}

/**
 * What the model actually saw on its most recent call.
 *
 * The head's own `usage` is a RUNNING total — the spec says so plainly, "the
 * head carries running usage and cost" — summed across every turn the session
 * has published, which makes it the right figure for "what did this run cost"
 * and the wrong one for "how full is the window". Dividing that sum by the
 * model's context window overflows on the session's second or third turn, not
 * its two-hundredth, because turn six's running total is turns one through
 * five added on top of it. What is actually IN the window right now is what
 * the last request sent, and that is a single turn's own `usage` tag — so this
 * walks backward from the end (turns arrive oldest first) and returns the
 * first one that carries a usage figure, skipping tool turns and any other
 * turn a runtime chose not to report one for.
 */
export function latestTurnUsage(turns: { usage?: Usage }[]): Usage | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const usage = turns[i].usage;
    if (usage) return usage;
  }
  return undefined;
}
