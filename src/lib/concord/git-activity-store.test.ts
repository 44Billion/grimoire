import { describe, expect, it } from "vitest";
import { EventStore } from "applesauce-core";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

import { gitActivityRows } from "@/lib/concord/git-activity";
import { parseGitRepositoryAddress } from "@/lib/concord/git";
import { GIT_ACTIVITY_KINDS } from "@/services/concord-git-activity";
import type { NostrEvent } from "@/types/nostr";

const SECRET = generateSecretKey();
const OWNER = getPublicKey(SECRET);
const COORD = `30617:${OWNER}:grimoire`;

/** A real signed event: the store rejects one whose id does not hash. */
function signed(kind: number, tags: string[][], createdAt: number): NostrEvent {
  return finalizeEvent(
    { kind, tags, content: "", created_at: createdAt },
    SECRET,
  ) as NostrEvent;
}

/**
 * The read the adapter actually performs. A tag query the store answered
 * differently — or a kind fetched but never mapped — would leave the timeline
 * silently empty, which is the one failure this feature cannot show.
 */
describe("the store query behind a channel's git rows", () => {
  it("answers a #a coordinate query and folds into rows", () => {
    const store = new EventStore();
    const issue = signed(
      1621,
      [
        ["a", COORD],
        ["subject", "Timelines hang in LOADING"],
      ],
      1_700_000_000,
    );
    expect(store.add(issue)).toBeTruthy();
    // A different repository's issue must not answer this channel's query.
    store.add(signed(1621, [["a", `30617:${OWNER}:chachi`]], 1_700_000_000));

    const events = store.getTimeline([
      { kinds: GIT_ACTIVITY_KINDS, "#a": [COORD] },
    ]);
    expect(events.map((e) => e.id)).toEqual([issue.id]);

    const rows = gitActivityRows(
      events,
      [
        {
          address: parseGitRepositoryAddress(COORD)!,
          relayHints: [],
          attachedAt: issue.created_at + 1,
        },
      ],
      "conv",
      issue.created_at + 100,
    );
    expect(rows.map((r) => r.content)).toEqual([
      "opened issue Timelines hang in LOADING",
    ]);
  });
});
