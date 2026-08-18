/**
 * What one NIP-29 group has waiting for a reader who last read at `after`.
 *
 * The same answer `channelUnreadSummary` and `dmUnreadSummary` give, over a
 * different substrate: those two walk a Dexie index because Concord and NIP-17
 * mirror their messages locally, and NIP-29 has no mirror at all — a kind 9
 * lives in the in-memory EventStore and nowhere else. So the input here is an
 * ARRAY: the bounded newest-first window `useGroupLastMessages` keeps per
 * `(relay, group)`. Pure and synchronous as a result, which is the one
 * simplification the missing mirror buys.
 *
 * The rules are the other two's, and each of them was a bug there first:
 *
 * - **The lower bound is EXCLUSIVE.** A message dated exactly `after` is the one
 *   the reader last read.
 * - **The upper bound is `nowSecs + maxFutureSecs`, not infinity.** `created_at`
 *   is author-chosen and the relay is not obliged to check it, so a year-3000
 *   message would otherwise pin the badge forever. Bounded here and at the stamp
 *   with the SAME number — see {@link NIP29_READ_MAX_FUTURE_SECS}.
 * - **The reader's own messages never count.** Sending is reading.
 * - **`latest` is the newest `created_at` among exactly the rows counted**, so a
 *   stamp built from it clears exactly what the badge counted and nothing the
 *   reader was not shown.
 *
 * KIND 9 ONLY, and the caller's window is filtered to it. The pane also renders
 * 9000, 9001 and 9321; counting joins and leaves would badge on membership
 * churn. That the counted kinds are a strict SUBSET of the rendered ones is what
 * lets the adapter's `markRead` stamp the newest message the pane loaded without
 * Concord's `max(loaded, latest)` composition — NIP-29 applies no moderation
 * fold, so the newest rendered message is never older than the newest counted
 * one.
 */

import { mentionsPubkey } from "@/lib/chat/mentions";
import type { NostrEvent } from "@/types/nostr";

/** How many unread messages one summary will count before answering "and more". */
export const NIP29_UNREAD_CAP = 99;

/**
 * How far ahead of the local clock a message may be dated and still count.
 *
 * The SCAN's ceiling, and this protocol's alone — unlike Concord and NIP-17, the
 * stamp does not share it. `markGroupRead` clamps at `now` instead, because a
 * NIP-29 stamp doubles as a `since` on the sidebar's REQ: one settled an hour
 * ahead would silently exclude every message sent during that hour from the
 * window, and mark it read besides. The reasoning is spelled out there.
 *
 * The asymmetry costs only that a future-dated message badges before it can be
 * stamped, which heals when the clock reaches it. One hour, matching the numbers
 * the other two protocols use.
 */
export const NIP29_READ_MAX_FUTURE_SECS = 3600;

/** What one group has waiting. Shaped for `UnreadBadge`. */
export interface GroupUnread {
  /** Qualifying messages in `(after, nowSecs + skew]`, capped. */
  count: number;
  /**
   * The newest counted message that has actually happened. 0 when none.
   *
   * A stamp target, so it is bounded by `nowSecs` rather than by the scan's
   * ceiling: "Mark as read" writes this straight through, and a NIP-29 stamp is
   * also a `since` on the sidebar's REQ — one set above every real message would
   * empty the window it bounds and blank the row. A future-dated message is
   * therefore counted but not offered as a stamp until the clock reaches it.
   */
  latest: number;
  /** Whether any counted message addresses the reader. */
  mention: boolean;
  /** Whether the count stopped at the cap, i.e. it is a floor. */
  capped: boolean;
}

const EMPTY: GroupUnread = {
  count: 0,
  latest: 0,
  mention: false,
  capped: false,
};

export function summarizeGroupUnread(
  /** One group's kind-9 messages. Order is not assumed. */
  events: readonly NostrEvent[],
  opts: {
    /** The reader's last-read stamp, in seconds. 0 means "never read". */
    after: number;
    nowSecs?: number;
    /** The reader, whose own messages are never unread. */
    selfPubkey?: string;
    cap?: number;
  },
): GroupUnread {
  if (events.length === 0) return EMPTY;
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const cap = opts.cap ?? NIP29_UNREAD_CAP;
  const upper = nowSecs + NIP29_READ_MAX_FUTURE_SECS;
  const after = Math.max(0, opts.after);
  if (upper <= after) return EMPTY;

  // Newest first, for the same reason the Dexie scans walk their cursor
  // backwards: `latest` has to be the newest qualifying message, and a capped
  // walk over the OLDEST hundred would report a stamp that can never reach past
  // the cap — the stuck badge, for exactly the >cap-unread case.
  const ordered = [...events].sort((a, b) => b.created_at - a.created_at);

  let count = 0;
  let latest = 0;
  let mention = false;
  for (const event of ordered) {
    if (count >= cap) return { count, latest, mention, capped: true };
    if (event.created_at <= after) break;
    if (event.created_at > upper) continue;
    if (opts.selfPubkey && event.pubkey === opts.selfPubkey) continue;
    // Bounded by `nowSecs`, not by `upper` — see the field's own note.
    if (event.created_at > latest && event.created_at <= nowSecs)
      latest = event.created_at;
    if (
      !mention &&
      opts.selfPubkey &&
      mentionsPubkey(event.tags, opts.selfPubkey)
    ) {
      mention = true;
    }
    count += 1;
  }
  // `capped` is false here even at exactly `cap` messages: the loop ran out of
  // events rather than stopping, so the count is exact.
  return { count, latest, mention, capped: false };
}
