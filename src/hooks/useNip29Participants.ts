/**
 * The AV roster of relay groups, for the UI.
 *
 * Two shapes over one service: the head count of every group the reader can see
 * (the sidebar), and one group's member list (the header button and the call
 * window). Both are ungated — a call you cannot see is a call you never join,
 * and a `kind:39004` costs one filter on a socket the group is already using.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { groupKey } from "@/lib/nip29/group-selection";
import {
  groupParticipantsOf,
  watchGroupParticipants,
} from "@/services/nip29-participants";

/** A group to watch. The pair, always — an id alone names no room. */
export interface WatchedGroup {
  groupId: string;
  relayUrl: string;
}

const NOBODY: string[] = [];

/**
 * Who is in one group's room, updating as the relay republishes.
 *
 * Read straight from the service's memory rather than mirrored into state, and
 * that is what makes switching groups safe: the snapshot is a function of the
 * CURRENT props, so a group with no room — or one whose relay has not
 * republished — shows nobody rather than whoever was in the group before it.
 * Mirroring left the previous group's members on screen under the new group's
 * name, because nothing arrives to correct a roster that does not exist.
 *
 * The snapshot is also referentially stable: the service hands back the same
 * array until a new `kind:39004` replaces it.
 */
export function useGroupParticipants(
  relayUrl: string | undefined,
  groupId: string | undefined,
): string[] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!relayUrl || !groupId) return () => {};
      return watchGroupParticipants(relayUrl, [groupId], onChange);
    },
    [relayUrl, groupId],
  );

  const snapshot = useCallback(
    () =>
      relayUrl && groupId ? groupParticipantsOf(relayUrl, groupId) : NOBODY,
    [relayUrl, groupId],
  );

  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * How many members are in each group's room, keyed `relayUrl'groupId`.
 *
 * Grouped by relay so the whole sidebar costs one REQ per relay rather than one
 * per group. The effect keys on a signature of the set rather than on the array
 * identity: the group list is rebuilt on every fold of the reader's kind-10009,
 * and re-subscribing for a set that did not change would restart every REQ on
 * every repaint.
 *
 * What the effect collects is never trimmed — a group the reader leaves simply
 * stops being asked about. The trimming happens on the way out instead, against
 * the set the caller is currently rendering, so a stale count cannot appear on a
 * row and an emptied list needs no write at all.
 */
export function useGroupCallCounts(
  groups: readonly WatchedGroup[],
): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  const byRelay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of groups) {
      const list = map.get(group.relayUrl);
      if (list) list.push(group.groupId);
      else map.set(group.relayUrl, [group.groupId]);
    }
    return map;
  }, [groups]);

  const signature = useMemo(
    () =>
      [...byRelay]
        .map(([relay, ids]) => `${relay}:${[...ids].sort().join(",")}`)
        .sort()
        .join("|"),
    [byRelay],
  );

  useEffect(() => {
    if (byRelay.size === 0) return;
    const stops = [...byRelay].map(([relayUrl, groupIds]) =>
      watchGroupParticipants(relayUrl, groupIds, (groupId, participants) =>
        setCounts((prev) => {
          const k = groupKey({ relayUrl, groupId });
          const now = participants.length;
          if ((prev.get(k) ?? 0) === now) return prev;
          const next = new Map(prev);
          if (now === 0) next.delete(k);
          else next.set(k, now);
          return next;
        }),
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
    // `byRelay` is rebuilt whenever the caller's array identity changes; the
    // signature is what says the watched SET changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return useMemo(() => {
    const live = new Map<string, number>();
    for (const group of groups) {
      const k = groupKey(group);
      const count = counts.get(k);
      if (count) live.set(k, count);
    }
    return live;
  }, [counts, groups]);
}
