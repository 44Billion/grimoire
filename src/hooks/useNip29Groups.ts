/**
 * The signed-in account's own NIP-29 groups, newest conversation first.
 *
 * The difference from {@link useNip29GroupList} is who has to know where the
 * list is. That hook is handed a pubkey, a list identifier and relay hints,
 * because it serves `chat naddr1…` — someone else's list, addressed explicitly.
 * This one serves a sidebar section, where there is no address to hand it: it
 * resolves the reader's own kind 10009 through the outbox loader, the same way
 * every other relay list this app reads is found.
 *
 * Kind 10009 is a plain replaceable list (NIP-51), not a parameterized one, so
 * the identifier is always `""` — there is one simple-groups list per account.
 */

import { useEffect, useMemo, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import { addressLoader } from "@/services/loaders";
import {
  extractGroupEntries,
  sortGroupsByRecency,
  useGroupLastMessages,
  type GroupEntry,
} from "./useNip29GroupList";

export function useNip29Groups(enabled = true): {
  groups: GroupEntry[];
  /** Signed out, or signed in with nothing published yet. */
  loading: boolean;
} {
  const account = use$(accountManager.active$);
  const pubkey = enabled ? account?.pubkey : undefined;

  /**
   * Whether the loader has finished looking, whatever it found.
   *
   * Without it, "loading" would be `no list yet`, which is indistinguishable
   * from `this account has never published one` — and that account would read
   * "Looking for your groups…" forever instead of being told how to join one.
   *
   * Holds WHOSE look finished rather than a boolean, so switching accounts
   * resets it by comparison instead of by an effect writing state on the way
   * in — the finished flag of the previous account must not answer for the
   * next one.
   */
  const [settledFor, setSettledFor] = useState<string>();

  // The loader picks the relays; no hardcoded set and no hint required. It
  // completes on its own, so this is a fetch with an unsubscribe rather than a
  // standing subscription.
  useEffect(() => {
    if (!pubkey) return;
    const done = () => setSettledFor(pubkey);
    const sub = addressLoader({
      kind: 10009,
      pubkey,
      identifier: "",
    }).subscribe({ complete: done, error: done });
    return () => sub.unsubscribe();
  }, [pubkey]);

  const groupListEvent = use$(
    () => (pubkey ? eventStore.replaceable(10009, pubkey, "") : undefined),
    [pubkey],
  );

  const entries = useMemo(
    () => extractGroupEntries(groupListEvent),
    [groupListEvent],
  );

  const lastMessages = useGroupLastMessages(entries);

  const groups = useMemo(
    () =>
      sortGroupsByRecency(
        entries.map((entry) => {
          const last = lastMessages.get(`${entry.relayUrl}'${entry.groupId}`);
          return {
            groupId: entry.groupId,
            relayUrl: entry.relayUrl,
            ...(last ? { lastMessage: last } : {}),
          };
        }),
      ),
    [entries, lastMessages],
  );

  return {
    groups,
    loading: !!pubkey && !groupListEvent && settledFor !== pubkey,
  };
}
