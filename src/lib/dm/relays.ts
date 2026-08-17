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
 * Sending and reading are deliberately asymmetric. A SEND goes to exactly what
 * the recipient nominated — spraying private mail at relays they never chose is
 * the thing NIP-17 exists to avoid. A READ of your own inbox is as wide as it
 * can be, because a wrap someone delivered to the wrong relay is still yours,
 * and asking a relay that has nothing costs one REQ.
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
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
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

/**
 * Normalise FIRST, then validate.
 *
 * `isValidRelayURL` requires an explicit `ws://` or `wss://`, but a relay list
 * in the wild routinely carries a bare `relay.example.com` — and
 * `normalizeRelayURL` adds the scheme. Filtering first threw those away; a
 * relay dropped here is mail nobody ever asks for.
 */
function clean(relays: string[]): string[] {
  const out = new Set<string>();
  for (const relay of relays) {
    if (typeof relay !== "string" || !relay.trim()) continue;
    try {
      const normalized = normalizeRelayURL(relay);
      if (isValidRelayURL(normalized)) out.add(normalized);
    } catch {
      // Not a URL at all.
    }
  }
  return [...out];
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

  const relays = clean(
    mergeRelaySets(
      dmList ? getRelaysFromList(dmList) : [],
      mailboxes ? getInboxes(mailboxes) : [],
      // BOTH directions of the NIP-65 list, not just the inboxes. A sender
      // whose client resolved the wrong side of a marked list — or that
      // ignores markers — delivers to a write relay, and a wrap sitting on one
      // is invisible to a reader that only asks the inboxes. Reading a relay
      // that turns out to hold nothing costs one REQ.
      mailboxes ? getOutboxes(mailboxes) : [],
      stateReadRelays(),
    ),
  );

  // Nowhere to read is not a state anything downstream can recover from — it
  // is silently zero conversations — so say so once, loudly, rather than
  // returning an empty list that looks like an empty inbox.
  if (relays.length === 0)
    console.warn(
      "[dm] no relays to read direct messages from: publish a kind 10050, or add read relays",
    );

  return relays;
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

/**
 * Who this account follows, for scoping the legacy read.
 *
 * The kind-4 era has no gift wrap deciding who may write to you, so an
 * unscoped `{kinds:[4], "#p":[self]}` imports every piece of spam ever
 * addressed at your key — and each one costs a signer round trip to find that
 * out. Scoping the RECEIVED direction to people you follow is what makes the
 * import affordable, and it is the same choice armada makes at the same place.
 *
 * The cost, stated rather than hidden: a legacy message from someone you do
 * not follow is not imported. Nothing about the newer gift-wrap path is
 * scoped this way — a wrap is addressed to you and only you can open it, so
 * there is nothing to defend against.
 */
export async function followedPubkeys(
  self: string,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<string[]> {
  const contacts = await firstReplaceable(kinds.Contacts, self, timeoutMs);
  if (!contacts) return [];
  return Array.from(
    new Set(
      contacts.tags
        .filter((t) => t[0] === "p" && typeof t[1] === "string")
        .map((t) => t[1])
        .filter((pubkey) => /^[0-9a-f]{64}$/i.test(pubkey))
        .map((pubkey) => pubkey.toLowerCase()),
    ),
  );
}
