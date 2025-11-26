import { useEffect } from "react";
import { useObservableMemo, useEventStore } from "applesauce-react/hooks";
import accounts from "@/services/accounts";
import { useGrimoire } from "@/core/state";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { addressLoader } from "@/services/loaders";
import type { RelayInfo, UserRelays } from "@/types/app";

/**
 * Hook that syncs active account with Grimoire state and fetches relay lists
 */
export function useAccountSync() {
  const { state, setActiveAccount, setActiveAccountRelays } = useGrimoire();
  const eventStore = useEventStore();

  // Watch active account from accounts service
  const activeAccount = useObservableMemo(() => accounts.active$, []);

  // Sync active account pubkey to state
  useEffect(() => {
    console.log("useAccountSync: activeAccount changed", activeAccount?.pubkey);
    if (activeAccount?.pubkey !== state.activeAccount?.pubkey) {
      console.log(
        "useAccountSync: setting active account",
        activeAccount?.pubkey,
      );
      setActiveAccount(activeAccount?.pubkey);
    }
  }, [activeAccount?.pubkey, state.activeAccount?.pubkey, setActiveAccount]);

  // Fetch and watch relay list (kind 10002) when account changes
  useEffect(() => {
    if (!activeAccount?.pubkey) {
      console.log("useAccountSync: no active account, skipping relay fetch");
      return;
    }

    const pubkey = activeAccount.pubkey;
    console.log("useAccountSync: fetching relay list for", pubkey);

    // Subscribe to kind 10002 (relay list)
    const subscription = addressLoader({
      kind: 10002,
      pubkey,
      identifier: "",
    }).subscribe();

    // Watch for relay list event in store
    const storeSubscription = eventStore
      .replaceable(10002, pubkey, "")
      .subscribe((relayListEvent) => {
        console.log(
          "useAccountSync: relay list event received",
          relayListEvent,
        );
        if (!relayListEvent) return;

        // Parse inbox and outbox relays
        const inboxRelays = getInboxes(relayListEvent);
        const outboxRelays = getOutboxes(relayListEvent);

        // Get all relays from tags
        const allRelays: RelayInfo[] = [];
        const seenUrls = new Set<string>();

        for (const tag of relayListEvent.tags) {
          if (tag[0] === "r") {
            const url = tag[1];
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            const type = tag[2];
            allRelays.push({
              url,
              read: !type || type === "read",
              write: !type || type === "write",
            });
          }
        }

        const relays: UserRelays = {
          inbox: inboxRelays.map((url) => ({
            url,
            read: true,
            write: false,
          })),
          outbox: outboxRelays.map((url) => ({
            url,
            read: false,
            write: true,
          })),
          all: allRelays,
        };

        console.log("useAccountSync: parsed relays", relays);
        setActiveAccountRelays(relays);
      });

    return () => {
      subscription.unsubscribe();
      storeSubscription.unsubscribe();
    };
  }, [activeAccount?.pubkey, eventStore, setActiveAccountRelays]);
}
