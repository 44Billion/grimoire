import { useCallback } from "react";
import { useListMembership } from "@/hooks/useFavoriteList";
import { nip65TagStrategy } from "@/lib/favorite-tag-strategies";
import {
  applyRelayMode,
  getRelayModeIn,
  writeRelaysOf,
} from "@/lib/relay-list-utils";
import type { RelayMode } from "@/lib/relay-list-utils";

/**
 * Per-relay edits to the user's NIP-65 relay list (kind 10002).
 *
 * Unlike the NIP-51 relay lists this is not a toggle: an `r` tag carries a
 * read/write mode, so the API is `mode(url)` / `setMode(url, mode | null)`.
 * The new revision is published to the union of the old and new write relays,
 * because outbox selection at publish time still sees the old list and would
 * otherwise never reach a relay that was just added.
 */
export function useRelayListMembership() {
  const { event, publishTags, isUpdating, canWrite } = useListMembership(
    10002,
    nip65TagStrategy,
  );

  const mode = useCallback(
    (url: string): RelayMode | null => getRelayModeIn(event?.tags ?? [], url),
    [event],
  );

  const setMode = useCallback(
    async (url: string, next: RelayMode | null) => {
      const current = event?.tags ?? [];
      const tags = applyRelayMode(current, url, next);
      if (!tags) return;
      const relays = [
        ...new Set([...writeRelaysOf(current), ...writeRelaysOf(tags)]),
      ];
      await publishTags(() => tags, {
        relays: relays.length > 0 ? relays : undefined,
      });
    },
    [event, publishTags],
  );

  return { mode, setMode, isUpdating, canWrite };
}
