/**
 * Who is in a relay group's AV space (NIP-29 `kind:39004`).
 *
 * The relay publishes this and nobody else can: it runs the LiveKit room, it
 * issues every token, and it is the only party that knows who is actually
 * connected. So there is nothing to cross-check the list against, and the trust
 * model is the one `kind:39000` already has — the relay hosting a group is
 * authoritative about that group, and a client reading a group from a relay has
 * already accepted that. What the fold does NOT do is take the relay's word over
 * the room's: see `foldGroupRoster`.
 *
 * Two rules this file exists to hold:
 *
 * 1. **The fold reads the subscription, never the store.** A group id is only
 *    unique within its relay, so `eventStore.replaceable(39004, …)` — keyed on
 *    the address alone — would merge two relays' `bitcoin` rooms into one
 *    roster. The subscription knows which relay it opened; the store does not.
 *    Events are still fed to the store (dropping them would cost the group's
 *    other readers their copies); it is the READ that stays relay-scoped.
 * 2. **The latest list per group is remembered at module level.** A watcher that
 *    mounts second — the call window, over a sidebar that has been subscribed
 *    since the app started — otherwise renders an empty room until the relay
 *    next republishes, which may be never if nobody joins or leaves.
 */

import { isNostrEvent } from "@/lib/type-guards";
import { parseParticipants } from "@/lib/nip29/livekit";
import { groupKey } from "@/lib/nip29/group-selection";
import { normalizeRelayURL } from "@/lib/relay-url";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import type { NostrEvent } from "@/types/nostr";

/** The newest 39004 seen per `relay'group`, and the members it named. */
const latest = new Map<string, { createdAt: number; participants: string[] }>();

/**
 * The answer for a group nothing is known about — one array, always the same
 * one. Callers compare snapshots by reference (`useSyncExternalStore`), and a
 * fresh `[]` per call reads as "changed" every time: an unknown group would
 * re-render until React gave up.
 */
export const NOBODY: string[] = [];

function key(relayUrl: string, groupId: string): string {
  // The relay is normalized and the group id is NOT: `#d` is case-sensitive and
  // relay-assigned, so `Bitcoin` and `bitcoin` are two rooms.
  return groupKey({ relayUrl: normalizeRelayURL(relayUrl), groupId });
}

/** Forget every remembered roster. Tests only — nothing in the app clears it. */
export function _clearGroupParticipantsForTests(): void {
  latest.clear();
}

/** The members last seen in a group's room, for a watcher that just mounted. */
export function groupParticipantsOf(
  relayUrl: string,
  groupId: string,
): string[] {
  return latest.get(key(relayUrl, groupId))?.participants ?? NOBODY;
}

/**
 * Fold one event into the memory, and say whether anything changed.
 *
 * Out-of-order delivery is normal with several relay copies in flight, so an
 * older event never overwrites a newer one. Equal timestamps are taken as the
 * later arrival winning: a relay republishing within the same second is
 * announcing a change, and the alternative pins the roster for a second on a
 * busy room.
 */
function absorb(relayUrl: string, event: NostrEvent): string | undefined {
  const groupId = event.tags.find((t) => t[0] === "d")?.[1];
  if (!groupId) return undefined;
  const k = key(relayUrl, groupId);
  const previous = latest.get(k);
  if (previous && previous.createdAt > event.created_at) return undefined;
  latest.set(k, {
    createdAt: event.created_at,
    participants: parseParticipants(event),
  });
  return groupId;
}

/**
 * Watch the AV rosters of some groups on one relay.
 *
 * One REQ carrying one filter for the whole set, because a `kind:39004` is
 * addressable and `#d` takes a list — there is no per-group `limit` to preserve
 * the way the last-message REQ has. Callers do not share subscriptions: two
 * watchers of one group cost two REQs on a socket that is open anyway, and the
 * remembered roster above is what makes the second one useful immediately,
 * which is the thing refcounting would have bought.
 */
export function watchGroupParticipants(
  relayUrl: string,
  groupIds: readonly string[],
  onUpdate: (groupId: string, participants: string[]) => void,
): () => void {
  if (groupIds.length === 0) return () => {};

  // Everything already known, before a single frame arrives.
  for (const groupId of groupIds) {
    const known = latest.get(key(relayUrl, groupId));
    if (known) onUpdate(groupId, known.participants);
  }

  const wanted = new Set(groupIds);
  const subscription = pool
    .subscription([relayUrl], [{ kinds: [39004], "#d": [...groupIds] }], {
      eventStore,
    })
    .subscribe((response) => {
      if (!isNostrEvent(response)) return;
      const groupId = absorb(relayUrl, response);
      if (!groupId || !wanted.has(groupId)) return;
      onUpdate(groupId, groupParticipantsOf(relayUrl, groupId));
    });

  return () => subscription.unsubscribe();
}
