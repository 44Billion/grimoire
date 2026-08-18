/**
 * The bounded newest-first window of messages the sidebar keeps per group.
 *
 * NIP-29 has no local mirror — a kind 9 lives in the in-memory EventStore and
 * nowhere else — so the unread count is computed over whatever the sidebar's
 * standing REQ has collected. This is that collection: capped, deduped, newest
 * first, and pure so the merge can be tested without a relay.
 *
 * Kept as an ARRAY rather than read back out of the EventStore, because the
 * store is not relay-scoped and a `{"#h":[groupId]}` query cannot be: a group id
 * is only unique within the relay hosting it, so two relays each hosting a
 * `bitcoin` would count into one another. The subscription knows which relay it
 * opened; the store does not.
 */

import type { NostrEvent } from "@/types/nostr";

/**
 * Fold new events into one group's window.
 *
 * One past the cap on purpose: the summary treats a full window as a floor, so
 * it needs one message more than it will report to know the count was capped.
 */
export function mergeGroupWindow(
  existing: readonly NostrEvent[],
  incoming: readonly NostrEvent[],
  cap: number,
): NostrEvent[] {
  if (incoming.length === 0) return existing as NostrEvent[];
  const byId = new Map<string, NostrEvent>();
  for (const event of existing) byId.set(event.id, event);
  let changed = false;
  for (const event of incoming) {
    if (byId.has(event.id)) continue;
    byId.set(event.id, event);
    changed = true;
  }
  // Identity is preserved when nothing is new: four inbox relays delivering four
  // copies of the same message must not repaint the sidebar four times.
  if (!changed) return existing as NostrEvent[];
  return [...byId.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, cap);
}
