/**
 * A NIP-29 group's pinned events (`kind:39005`, mirroring `kind:9010`).
 *
 * Unlike Concord's pins (CORD-04 §7), nothing here is sealed: kind 9 messages
 * are public, so a pin is a plain reference and there is no "unavailable"
 * state to keep apart from "no pins". Rendering reuses Concord's own
 * `PinsHeaderButton` / `ConcordPinsList` — see `eventToPinFields` in
 * `@/lib/nip29/pins` for why that costs nothing.
 *
 * Order is the list's OWN, not by date: the NIP says pins are "in the order
 * they should be displayed", and re-sorting would undo an admin's curation.
 */

import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { requestEvent } from "@/lib/relay-subscription";
import {
  eventToPinFields,
  KIND_GROUP_PIN_LIST,
  parsePinAddress,
  parsePinListEntries,
} from "@/lib/nip29/pins";
import type { VerifiedPin } from "@/lib/concord/pins";
import type { NostrEvent } from "@/types/nostr";

export interface Nip29Pins {
  /** Pinned events, in the list's own display order. */
  pins: VerifiedPin[];
  /** Still resolving one or more pinned references. */
  loading: boolean;
}

const NONE: Nip29Pins = { pins: [], loading: false };

/**
 * Hook that watches a single group's `kind:39005` and resolves what it
 * points at.
 *
 * Subscribes on the group's own relay, the same pattern `useGroupMetadata`
 * uses for `kind:39000` — a group id is only unique within its relay, so the
 * read has to stay relay-scoped rather than trusting the store's address
 * index.
 */
export function useNip29Pins(
  groupId: string | undefined,
  relayUrl: string | undefined,
): Nip29Pins {
  const isUnmanaged = groupId === "_";

  useEffect(() => {
    if (!groupId || !relayUrl || isUnmanaged) return;
    const sub = pool
      .subscription(
        [relayUrl],
        [{ kinds: [KIND_GROUP_PIN_LIST], "#d": [groupId] }],
        { eventStore },
      )
      .subscribe();
    return () => sub.unsubscribe();
  }, [groupId, relayUrl, isUnmanaged]);

  const normalizedRelay = relayUrl?.replace(/\/$/, "");
  const pinListEvent = use$(
    () =>
      groupId && relayUrl && !isUnmanaged
        ? eventStore
            .timeline([{ kinds: [KIND_GROUP_PIN_LIST], "#d": [groupId] }])
            .pipe(
              map((events) => {
                const fromRelay = events.find((evt) => {
                  const seen = getSeenRelays(evt);
                  if (!seen || seen.size === 0) return false;
                  return Array.from(seen).some(
                    (r) => r.replace(/\/$/, "") === normalizedRelay,
                  );
                });
                return fromRelay ?? events[0];
              }),
            )
        : undefined,
    [groupId, relayUrl, isUnmanaged, normalizedRelay],
  );

  const [resolved, setResolved] = useState<Nip29Pins>(NONE);

  useEffect(() => {
    if (!relayUrl || !pinListEvent) {
      setResolved(NONE);
      return;
    }

    let cancelled = false;
    const entries = parsePinListEntries(pinListEvent.tags);

    if (entries.length === 0) {
      setResolved(NONE);
      return;
    }

    setResolved((prev) => ({ pins: prev.pins, loading: true }));

    void (async () => {
      const pins: VerifiedPin[] = [];
      for (const entry of entries) {
        if (cancelled) return;
        let resolvedEvent: NostrEvent | undefined;
        if (entry.type === "e") {
          resolvedEvent =
            eventStore.getEvent(entry.id) ??
            (await requestEvent([relayUrl], { ids: [entry.id] })
              .catch(() => null)
              .then((e) => e ?? undefined));
        } else {
          const address = parsePinAddress(entry.address);
          if (!address) continue;
          resolvedEvent =
            eventStore.getReplaceable(
              address.kind,
              address.pubkey,
              address.identifier,
            ) ??
            (await requestEvent([relayUrl], {
              kinds: [address.kind],
              authors: [address.pubkey],
              "#d": [address.identifier],
            })
              .catch(() => null)
              .then((e) => e ?? undefined));
        }
        // Dropped, not rendered as "probably fine" — the same rule Concord's
        // own pin verification uses for an entry that fails to open.
        if (resolvedEvent) pins.push(eventToPinFields(resolvedEvent));
      }
      if (!cancelled) setResolved({ pins, loading: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [relayUrl, pinListEvent]);

  return resolved;
}
