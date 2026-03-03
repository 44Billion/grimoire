import { useMemo } from "react";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { getOutboxes } from "applesauce-core/helpers";
import { getRepositoryRelays } from "@/lib/nip34-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import type { NostrEvent } from "@/types/nostr";

/**
 * Resolves the relay list for a NIP-34 git repository address.
 *
 * Fallback chain:
 * 1. Relays from the repository event's `relays` tag (kind 30617)
 * 2. Repository owner's outbox relays (kind 10002)
 * 3. Well-known aggregator relays
 *
 * Also returns the repository event, needed by callers for getValidStatusAuthors.
 */
export function useRepositoryRelays(repoAddress: string | undefined): {
  relays: string[];
  repositoryEvent: NostrEvent | undefined;
} {
  const repoPointer = useMemo(
    () => (repoAddress ? parseReplaceableAddress(repoAddress) : undefined),
    [repoAddress],
  );

  const repositoryEvent = useNostrEvent(repoPointer);

  const authorRelayListPointer = useMemo(
    () =>
      repoPointer
        ? { kind: 10002, pubkey: repoPointer.pubkey, identifier: "" }
        : undefined,
    [repoPointer],
  );

  const authorRelayList = useNostrEvent(authorRelayListPointer);

  const relays = useMemo(() => {
    if (repositoryEvent) {
      const repoRelays = getRepositoryRelays(repositoryEvent);
      if (repoRelays.length > 0) return repoRelays;
    }
    if (authorRelayList) {
      const outbox = getOutboxes(authorRelayList);
      if (outbox.length > 0) return outbox;
    }
    return AGGREGATOR_RELAYS;
  }, [repositoryEvent, authorRelayList]);

  return { relays, repositoryEvent };
}
