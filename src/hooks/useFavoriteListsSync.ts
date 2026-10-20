import { useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { useAccount } from "./useAccount";
import { useUserRelays } from "./useUserRelays";
import { useStableArray } from "./useStable";
import { ALL_FAVORITE_LIST_KINDS } from "@/config/favorite-lists";
import { addressLoader } from "@/services/loaders";
import { markListLoaded, listLoaded$ } from "@/services/list-sync-state";

/**
 * Fetch all configured favorite list kinds (and the kind 3 contact list) from
 * relays at app boot, so they're available in EventStore before any UI needs
 * them. Each loader marks its list as loaded on completion; the membership
 * hooks refuse to write a list that is neither in the store nor marked.
 *
 * Nothing is fetched (and so nothing is marked) until the user's kind 10002
 * has been resolved by useAccountSync. Before that `outboxRelays` is empty, a
 * loader that completes against indexers alone would mark a list "loaded"
 * while the real copy still sits on the user's write relays, and the first
 * toggle would publish a one-entry list over it.
 */
export function useFavoriteListsSync() {
  const { pubkey } = useAccount();
  const { outboxRelays } = useUserRelays(pubkey);
  const stableRelays = useStableArray(outboxRelays ?? []);
  const relayListLoaded =
    use$(() => (pubkey ? listLoaded$(10002, pubkey) : undefined), [pubkey]) ??
    false;

  useEffect(() => {
    if (!pubkey || !relayListLoaded) return;

    const subs = ALL_FAVORITE_LIST_KINDS.map((listKind) =>
      addressLoader({
        kind: listKind,
        pubkey,
        identifier: "",
        relays: stableRelays,
      }).subscribe({ complete: () => markListLoaded(listKind, pubkey) }),
    );

    // Kind 3 is a discovery kind, so the loader always adds the indexers; the
    // outbox relays are passed on top in case the list lives only there.
    subs.push(
      addressLoader({
        kind: 3,
        pubkey,
        identifier: "",
        relays: stableRelays,
      }).subscribe({
        complete: () => markListLoaded(3, pubkey),
      }),
    );

    return () => subs.forEach((s) => s.unsubscribe());
  }, [pubkey, stableRelays, relayListLoaded]);
}
