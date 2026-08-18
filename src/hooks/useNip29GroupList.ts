import { useState, useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import accountManager from "@/services/accounts";
import { groupReadKey, readAllGroupLastReads } from "@/services/nip29-reads";
import { mergeGroupWindow } from "@/lib/nip29/message-window";
import { NIP29_UNREAD_CAP } from "@/lib/nip29/unread";
import { useStableArray } from "@/hooks/useStable";
import type { NostrEvent } from "@/types/nostr";

export interface GroupEntry {
  groupId: string;
  relayUrl: string;
  lastMessage?: NostrEvent;
}

/**
 * Hook that loads a kind 10009 group list, extracts groups,
 * and subscribes per-relay for last messages (kind 9).
 *
 * Keys last-message map by `relayUrl'groupId` to prevent
 * cross-relay contamination when groups share the same ID.
 */
/**
 * The `group` tags of a kind-10009 list, as relay-scoped entries.
 *
 * A group id is only unique WITHIN a relay, so an entry that lost its relay is
 * dropped rather than guessed at — two relays can each host a `bitcoin` and
 * they are not the same room.
 */
export function extractGroupEntries(
  groupListEvent: NostrEvent | undefined,
): Array<{ groupId: string; relayUrl: string }> {
  if (!groupListEvent) return [];

  const result: Array<{ groupId: string; relayUrl: string }> = [];
  for (const tag of groupListEvent.tags) {
    if (tag[0] !== "group" || !tag[1] || !tag[2]) continue;
    const raw = tag[2];
    try {
      const url = new URL(
        raw.startsWith("ws://") || raw.startsWith("wss://")
          ? raw
          : `wss://${raw}`,
      );
      if (url.protocol === "ws:" || url.protocol === "wss:")
        result.push({ groupId: tag[1], relayUrl: url.toString() });
    } catch {
      continue;
    }
  }
  return result;
}

/**
 * A bounded newest-first window of each group's messages, keyed `relayUrl'groupId`.
 *
 * One filter per group so `limit` applies per group rather than once across the
 * whole REQ, and one subscription per relay so an event is attributed to the
 * relay it came from — group ids collide across relays, and nothing downstream
 * can recover the attribution afterwards.
 *
 * The window is wide enough to COUNT, not just to sort. That is the whole
 * difference from the `limit: 1` this used to be: an unread badge needs to know
 * how many messages arrived since the reader's stamp, and NIP-29 has no local
 * mirror to ask.
 *
 * Two things make the width affordable:
 *
 * 1. **`since` is the reader's own stamp.** A group that is caught up asks for
 *    almost nothing. It is resolved ONCE per (reader, group set) and is
 *    deliberately not a dependency of the subscription: a stamp only ever moves
 *    forward, which can only SHRINK a count computed client-side, so
 *    re-subscribing on every mark would cost one REQ per relay per message read.
 *    A group with no stamp yet gets no `since` at all — a time floor would
 *    return nothing for a quiet group nobody has opened, which would erase its
 *    last message and demote it out of the recency sort.
 * 2. **Events are batched.** A cold open delivers up to the cap per group at
 *    once, and a `setState` per event would repaint the whole sidebar for each.
 */
const FLUSH_MS = 200;

/** One past the cap, so the summary can tell a full window from an exact count. */
const WINDOW = NIP29_UNREAD_CAP + 1;

export function useGroupMessageWindows(
  entries: Array<{ groupId: string; relayUrl: string }>,
): Map<string, NostrEvent[]> {
  const [windows, setWindows] = useState<Map<string, NostrEvent[]>>(new Map());

  // The READER, not the list's owner: `useNip29GroupList` serves someone else's
  // kind 10009, and whose stamps bound the fetch is always the person looking.
  const account = use$(accountManager.active$);
  const reader = account?.pubkey;

  // The resolved stamps carry WHOSE look they answer rather than being cleared
  // by an effect, the shape the other hooks here use: a `since` map from the
  // previous account or the previous group set must not bound the next one's REQ.
  const token = useMemo(
    () =>
      `${reader ?? ""}|${entries
        .map((e) => `${e.relayUrl}'${e.groupId}`)
        .sort()
        .join(",")}`,
    [entries, reader],
  );
  const [since, setSince] = useState<{
    token: string;
    map: Map<string, number>;
  }>();

  useEffect(() => {
    let cancelled = false;
    void readAllGroupLastReads(reader || "").then((stamps) => {
      if (cancelled) return;
      const map = new Map<string, number>();
      for (const entry of entries) {
        // Through the same normalizer the rows were written with — the sidebar's
        // relay URL carries a trailing slash the adapter's does not, and a raw
        // lookup here would silently bound nothing.
        const readKey = groupReadKey(entry.relayUrl, entry.groupId);
        const stamp = readKey ? stamps.get(readKey) : undefined;
        if (stamp && stamp > 0)
          map.set(`${entry.relayUrl}'${entry.groupId}`, stamp);
      }
      setSince({ token, map });
    });
    return () => {
      cancelled = true;
    };
  }, [entries, reader, token]);

  const resolved = since?.token === token ? since.map : undefined;

  useEffect(() => {
    if (entries.length === 0 || !resolved) return;

    const byRelay = new Map<string, string[]>();
    for (const g of entries) {
      const list = byRelay.get(g.relayUrl) || [];
      list.push(g.groupId);
      byRelay.set(g.relayUrl, list);
    }

    const pending = new Map<string, NostrEvent[]>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      timer = undefined;
      if (pending.size === 0) return;
      const batch = new Map(pending);
      pending.clear();
      setWindows((prev) => {
        let next: Map<string, NostrEvent[]> | undefined;
        for (const [key, events] of batch) {
          const before = prev.get(key) || [];
          const merged = mergeGroupWindow(before, events, WINDOW);
          // Identity, not length: four copies of one message from four relays
          // must not repaint anything.
          if (merged === before) continue;
          next = next || new Map(prev);
          next.set(key, merged);
        }
        return next || prev;
      });
    };

    const subs: Array<{ unsubscribe: () => void }> = [];

    for (const [relayUrl, groupIds] of byRelay) {
      const filters = groupIds.map((gid) => {
        const stamp = resolved.get(`${relayUrl}'${gid}`);
        return {
          kinds: [9],
          "#h": [gid],
          limit: WINDOW,
          // `since` is INCLUSIVE in NIP-01, so the message dated exactly at the
          // stamp comes back: the count's lower bound is exclusive and skips it,
          // while the recency sort still has a last message to show.
          ...(stamp ? { since: stamp } : {}),
        };
      });

      const sub = pool
        .subscription([relayUrl], filters, { eventStore })
        .subscribe((response) => {
          if (!isNostrEvent(response)) return;

          const groupId = response.tags.find((t) => t[0] === "h")?.[1];
          if (!groupId || !groupIds.includes(groupId)) return;

          const key = `${relayUrl}'${groupId}`;
          const list = pending.get(key) || [];
          list.push(response);
          pending.set(key, list);
          if (!timer) timer = setTimeout(flush, FLUSH_MS);
        });

      subs.push(sub);
    }

    return () => {
      subs.forEach((s) => s.unsubscribe());
      if (timer) clearTimeout(timer);
    };
  }, [entries, resolved]);

  return windows;
}

/** The newest message in each group, keyed `relayUrl'groupId`. */
export function useGroupLastMessages(
  entries: Array<{ groupId: string; relayUrl: string }>,
): Map<string, NostrEvent> {
  const windows = useGroupMessageWindows(entries);
  return useMemo(() => {
    const out = new Map<string, NostrEvent>();
    for (const [key, events] of windows) if (events[0]) out.set(key, events[0]);
    return out;
  }, [windows]);
}

/** Newest first. A group nobody has written in yet sorts last, not first. */
export function sortGroupsByRecency(groups: GroupEntry[]): GroupEntry[] {
  return [...groups].sort(
    (a, b) =>
      (b.lastMessage?.created_at || 0) - (a.lastMessage?.created_at || 0),
  );
}

export function useNip29GroupList(
  pubkey: string | undefined,
  identifier: string,
  relays?: string[],
): {
  groupListEvent: NostrEvent | undefined;
  groups: GroupEntry[];
  loading: boolean;
} {
  const stableRelays = useStableArray(relays || []);

  // Subscribe to kind 10009 from hint relays if provided
  useEffect(() => {
    if (!pubkey || stableRelays.length === 0) return;

    const sub = pool
      .subscription(
        stableRelays,
        [{ kinds: [10009], authors: [pubkey], "#d": [identifier] }],
        { eventStore },
      )
      .subscribe();

    return () => sub.unsubscribe();
  }, [pubkey, identifier, stableRelays]);

  // Observe the replaceable event from the store
  const groupListEvent = use$(
    () =>
      pubkey ? eventStore.replaceable(10009, pubkey, identifier) : undefined,
    [pubkey, identifier],
  );

  const extractedGroups = useMemo(
    () => extractGroupEntries(groupListEvent),
    [groupListEvent],
  );

  const lastMessageMap = useGroupLastMessages(extractedGroups);

  // Merge groups with last messages and sort by recency
  const groups: GroupEntry[] = useMemo(
    () =>
      sortGroupsByRecency(
        extractedGroups.map((g) => ({
          groupId: g.groupId,
          relayUrl: g.relayUrl,
          ...(lastMessageMap.get(`${g.relayUrl}'${g.groupId}`)
            ? { lastMessage: lastMessageMap.get(`${g.relayUrl}'${g.groupId}`)! }
            : {}),
        })),
      ),
    [extractedGroups, lastMessageMap],
  );

  return {
    groupListEvent,
    groups,
    loading: !groupListEvent && !!pubkey,
  };
}
