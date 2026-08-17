/**
 * Where a NIP-17 DM is read from and written to.
 *
 * NIP-17 gives a user a dedicated inbox list — kind 10050 — separate from the
 * NIP-65 mailboxes, because "where I want my private mail" and "where I publish"
 * are different questions. Not everyone has published one, so every lookup here
 * degrades: 10050, then the NIP-65 inbox, then nothing. The caller is told WHICH
 * of those answered, because "this peer has no DM inbox" is a thing a sender
 * needs to see before sending, not a silent best-effort.
 *
 * Nothing here ever publishes a 10050. A cold read that comes back empty is
 * indistinguishable from "no list exists", and writing that back would clobber
 * a replaceable event with the user's real inbox in it.
 */

import { firstValueFrom, timer, Subscription } from "rxjs";
import { filter, take, takeUntil, catchError } from "rxjs/operators";
import { of } from "rxjs";
import { kinds } from "nostr-tools";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import { getInboxes } from "applesauce-core/helpers/mailboxes";
import { mergeRelaySets } from "applesauce-core/helpers";
import { getDefaultStore } from "jotai";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import { normalizeRelayURL, isValidRelayURL } from "@/lib/relay-url";
import { grimoireStateAtom } from "@/core/state";

/** How long to wait for a relay list before answering "none". */
const RESOLVE_TIMEOUT_MS = 4_000;

/** Which list answered. `"none"` means the peer has no reachable inbox. */
export type DmRelaySource = "dm-relays" | "inboxes" | "none";

export interface DmRelayResolution {
  relays: string[];
  source: DmRelaySource;
}

function clean(relays: string[]): string[] {
  return Array.from(
    new Set(relays.filter(isValidRelayURL).map(normalizeRelayURL)),
  );
}

/** The user's own read relays as configured in grimoire, if any. */
function stateReadRelays(): string[] {
  const state = getDefaultStore().get(grimoireStateAtom);
  return (
    state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) ?? []
  );
}

/**
 * Pull a pubkey's 10050 and 10002 into the EventStore.
 *
 * Resolution is on a deadline, and a cold `replaceable()` read has to reach a
 * relay before it can answer. Warming at the point the conversation opens means
 * the answer is already in the store by the time someone presses send.
 *
 * The returned subscription must be torn down with the conversation.
 */
export function warmDmRelays(pubkeys: string[]): Subscription {
  const subscription = new Subscription();
  for (const pubkey of new Set(pubkeys)) {
    subscription.add(
      eventStore
        .replaceable({ kind: kinds.DirectMessageRelaysList, pubkey })
        .subscribe({ error: () => {} }),
    );
    subscription.add(
      eventStore
        .replaceable({ kind: kinds.RelayList, pubkey })
        .subscribe({ error: () => {} }),
    );
  }
  return subscription;
}

/** First value of a replaceable, or undefined once the deadline passes. */
async function firstReplaceable(
  kind: number,
  pubkey: string,
  timeoutMs: number,
): Promise<NostrEvent | undefined> {
  return firstValueFrom(
    eventStore.replaceable({ kind, pubkey }).pipe(
      filter((event): event is NostrEvent => !!event),
      take(1),
      takeUntil(timer(timeoutMs)),
      catchError(() => of(undefined)),
    ),
    { defaultValue: undefined },
  );
}

/**
 * Where to send a gift wrap addressed to `pubkey`.
 *
 * 10050 first — it is the list that means "my DMs go here". The NIP-65 inbox is
 * a fallback rather than an equal: a user who has published neither is not
 * reachable, and saying so beats spraying their outbox.
 */
export async function resolveDmRelays(
  pubkey: string,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<DmRelayResolution> {
  const dmList = await firstReplaceable(
    kinds.DirectMessageRelaysList,
    pubkey,
    timeoutMs,
  );
  const dmRelays = dmList ? clean(getRelaysFromList(dmList)) : [];
  if (dmRelays.length > 0) return { relays: dmRelays, source: "dm-relays" };

  const mailboxes = await firstReplaceable(kinds.RelayList, pubkey, timeoutMs);
  const inboxes = mailboxes ? clean(getInboxes(mailboxes)) : [];
  if (inboxes.length > 0) return { relays: inboxes, source: "inboxes" };

  return { relays: [], source: "none" };
}

/**
 * Where to watch for the user's own incoming wraps.
 *
 * Deliberately a UNION, not a fallback chain: a wrap sent before the user
 * published a 10050 is sitting on the old inbox, and a reader that follows only
 * the newest list never sees it. Reading widely costs a subscription; reading
 * narrowly loses mail.
 */
export async function ownDmReadRelays(
  self: string,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<string[]> {
  const [dmList, mailboxes] = await Promise.all([
    firstReplaceable(kinds.DirectMessageRelaysList, self, timeoutMs),
    firstReplaceable(kinds.RelayList, self, timeoutMs),
  ]);

  return clean(
    mergeRelaySets(
      dmList ? getRelaysFromList(dmList) : [],
      mailboxes ? getInboxes(mailboxes) : [],
      stateReadRelays(),
    ),
  );
}

/** Whether the user has published a 10050 at all — drives the setup banner. */
export async function hasOwnDmRelayList(
  self: string,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<boolean> {
  const event = await firstReplaceable(
    kinds.DirectMessageRelaysList,
    self,
    timeoutMs,
  );
  return !!event && clean(getRelaysFromList(event)).length > 0;
}
