/**
 * Live unread counts for the NIP-29 section of the chat sidebar.
 *
 * A JOIN of two halves that live in different places, which is what makes this
 * hook look unlike its Concord twin:
 *
 * - the **stamps** are Dexie rows, watched with `useLiveQuery` so a second chat
 *   window marking a group read clears the badge in this one — the whole reason
 *   `chatReads` is a table rather than a jotai atom;
 * - the **messages** are in memory, in the bounded per-group windows
 *   `useGroupMessageWindows` collects. NIP-29 has no local mirror, so there is
 *   nothing for a live query to scan.
 *
 * The consequence is that the count is only as deep as the window: a group with
 * more than {@link NIP29_UNREAD_CAP} unread reports the cap and says so through
 * `capped`. Concord's badge has the same ceiling for the same reason.
 */

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { use$ } from "applesauce-react/hooks";

import accountManager from "@/services/accounts";
import { groupReadKey, readAllGroupLastReads } from "@/services/nip29-reads";
import { summarizeGroupUnread, type GroupUnread } from "@/lib/nip29/unread";
import type { NostrEvent } from "@/types/nostr";

const EMPTY = new Map<string, GroupUnread>();

/**
 * How often the clock behind the scan's ceiling is refreshed.
 *
 * Well under `NIP29_READ_MAX_FUTURE_SECS`, so the ceiling can never fall behind
 * real time: a message arriving now is counted now, not after the next tick.
 */
const CLOCK_MS = 60_000;

/**
 * What each group has waiting, keyed `relayUrl'groupId` — the sidebar's own key,
 * so a caller can look up a row without knowing the stamps are keyed differently.
 *
 * The stamp lookup normalizes the relay through {@link groupReadKey} because it
 * has to: the row was written from a normalized URL and this map is keyed by the
 * raw one out of the kind-10009 tag.
 */
export function useNip29Unread(
  entries: Array<{ groupId: string; relayUrl: string }>,
  windows: Map<string, NostrEvent[]>,
): Map<string, GroupUnread> {
  const pubkey = use$(accountManager.active$)?.pubkey;

  // Only the stamps are watched. The windows are React state and re-render this
  // hook on their own, so folding them into the query would buy nothing and cost
  // a Dexie round trip per message.
  //
  // The clock rides along inside the querier because render must stay pure — and
  // that is exactly why the tick below exists. A `useLiveQuery` re-runs on a deps
  // change or a mutation to a range it observes, and NIP-29 supplies NEITHER:
  // there is no local mirror to write, and `markGroupRead` returns without
  // writing whenever the stamp would not move. Concord gets away with the same
  // shape only because its ingest writes Dexie on every message.
  //
  // Left frozen, `nowSecs` drifts into the past and `nowSecs + maxFuture` with
  // it, until every arriving message reads as future-dated and is skipped: a
  // window left open counts to zero and stays there. The tick is the refire
  // source, not a nicety.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const read = useLiveQuery(
    async () =>
      pubkey
        ? {
            stamps: await readAllGroupLastReads(pubkey),
            nowSecs: Math.floor(Date.now() / 1000),
          }
        : undefined,
    [pubkey, tick],
  );

  const entriesKey = entries
    .map((e) => `${e.relayUrl}'${e.groupId}`)
    .sort()
    .join(",");

  return useMemo(() => {
    if (!read || entries.length === 0) return EMPTY;
    const { stamps, nowSecs } = read;
    const out = new Map<string, GroupUnread>();
    for (const entry of entries) {
      const key = `${entry.relayUrl}'${entry.groupId}`;
      const events = windows.get(key);
      if (!events || events.length === 0) continue;
      const readKey = groupReadKey(entry.relayUrl, entry.groupId);
      const summary = summarizeGroupUnread(events, {
        after: (readKey && stamps.get(readKey)) || 0,
        nowSecs,
        ...(pubkey ? { selfPubkey: pubkey } : {}),
      });
      if (summary.count > 0) out.set(key, summary);
    }
    return out.size > 0 ? out : EMPTY;
    // `entries` is rebuilt from the group list on every read; its joined keys are
    // its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesKey, windows, read, pubkey]);
}
