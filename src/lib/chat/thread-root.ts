/**
 * Reading a thread root and an immediate parent off NIP-10 tags.
 *
 * Shared by the NIP-17 read path (`Message.threadRoot`) and its write path (the
 * `root` marker a new reply inherits), because the two disagreeing would file a
 * reply under a thread the timeline draws somewhere else.
 *
 * `getNip10References` already covers the deprecated positional form, which is
 * what makes this safe to turn on over existing conversations: every NIP-17
 * reply written before markers existed carries one unmarked `["e", parentId]`,
 * and applesauce reports that tag as BOTH root and reply. So a pre-marker reply
 * threads under its parent rather than under the true root — one level shallower
 * than the truth, and visible, which is the trade a reader wants over an orphan.
 */

import { getNip10References } from "applesauce-common/helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Anything carrying tags. A stored rumor row qualifies, which is the point —
 * the NIP-17 paths never hold a signed event.
 *
 * Note that `getNip10References` memoizes on a symbol it sets on the object.
 * Every caller here passes a freshly built object or a freshly read Dexie row,
 * so there is nothing long-lived to go stale.
 */
export type TaggedLike = Pick<NostrEvent, "tags">;

/** The root of this event's thread, or `undefined` if it starts one. */
export function nip10ThreadRoot(event: TaggedLike): string | undefined {
  return getNip10References(event as NostrEvent).root?.e?.id;
}

/**
 * The immediate parent, which is not always the root.
 *
 * A reply directly to the root names it once and means both, and applesauce
 * reports it in both slots, so this needs no fallback.
 */
export function nip10Parent(event: TaggedLike): string | undefined {
  return getNip10References(event as NostrEvent).reply?.e?.id;
}
