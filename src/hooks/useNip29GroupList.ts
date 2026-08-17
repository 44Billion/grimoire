import { useState, useMemo, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
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
 * The newest message in each group, keyed `relayUrl'groupId`.
 *
 * One filter per group so `limit: 1` applies per group rather than once across
 * the whole REQ, and one subscription per relay so an event is attributed to
 * the relay it came from — group ids collide across relays.
 */
export function useGroupLastMessages(
  entries: Array<{ groupId: string; relayUrl: string }>,
): Map<string, NostrEvent> {
  const [lastMessageMap, setLastMessageMap] = useState<Map<string, NostrEvent>>(
    new Map(),
  );

  useEffect(() => {
    if (entries.length === 0) return;

    const byRelay = new Map<string, string[]>();
    for (const g of entries) {
      const list = byRelay.get(g.relayUrl) || [];
      list.push(g.groupId);
      byRelay.set(g.relayUrl, list);
    }

    const subs: Array<{ unsubscribe: () => void }> = [];

    for (const [relayUrl, groupIds] of byRelay) {
      const filters = groupIds.map((gid) => ({
        kinds: [9],
        "#h": [gid],
        limit: 1,
      }));

      const sub = pool
        .subscription([relayUrl], filters, { eventStore })
        .subscribe((response) => {
          if (!isNostrEvent(response)) return;

          const groupId = response.tags.find((t) => t[0] === "h")?.[1];
          if (!groupId || !groupIds.includes(groupId)) return;

          const key = `${relayUrl}'${groupId}`;
          setLastMessageMap((prev) => {
            const existing = prev.get(key);
            if (existing && existing.created_at >= response.created_at)
              return prev;
            const next = new Map(prev);
            next.set(key, response);
            return next;
          });
        });

      subs.push(sub);
    }

    return () => subs.forEach((s) => s.unsubscribe());
  }, [entries]);

  return lastMessageMap;
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
