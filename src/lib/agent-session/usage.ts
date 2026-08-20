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
