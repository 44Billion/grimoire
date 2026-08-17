/**
 * The ephemeral wire — standing kind-21059 subscriptions, in memory only.
 *
 * Realtime-only traffic (voice presence, CORD-07 §4) rides the ephemeral wrap:
 * same stream address, same seal, but relays MUST NOT store it. That makes it
 * the opposite of everything `concord-wire.ts` does — there is no history to
 * page, no cursor to advance, and nothing to write to Dexie. A missed event is
 * simply gone, and the protocol heals it with the next heartbeat.
 *
 * So it gets its own door rather than a `WRAP_KINDS` entry: an ephemeral wrap
 * that reached the durable ingest would be filed as a rumor and outlive the call
 * it described.
 *
 * One REQ per relay, whatever the caller count. Every open Concord channel of a
 * community shares a filter — `{kinds:[21059], authors:[…current pks]}` — and
 * arrivals are demultiplexed by the wrap's author, which names the channel
 * exactly. Subscribers refcount the addresses they care about; the last one out
 * closes the REQ.
 */

import type { Filter, NostrEvent } from "nostr-tools";

import { KIND_WRAP_EPHEMERAL } from "@/lib/concord/kinds";
import { planeStream } from "@/lib/concord/plane-request";
import concordPool from "@/services/concord-relay-pool";

/** Called with every wrap arriving at a subscribed address. */
export type EphemeralListener = (event: NostrEvent) => void;

/**
 * Reconnect backoff. Ephemeral traffic is worthless once missed, so there is no
 * catch-up to rush back for — but a call in progress goes blind while the socket
 * is down, so the first retries stay quick.
 */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Coalesce address changes before restarting a relay's REQ. Opening a community
 * registers its channels one at a time, and restarting per channel would mint a
 * REQ per channel — the flood this codebase has already paid for once.
 */
const SETTLE_MS = 50;

interface RelayLoop {
  /** Address → how many subscribers want it here. */
  wanted: Map<string, number>;
  /** The address set the live REQ was opened for. */
  live: string;
  stop?: () => void;
  settle?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  attempt: number;
}

const loops = new Map<string, RelayLoop>();
const listeners = new Map<string, Set<EphemeralListener>>();

function signatureOf(wanted: Map<string, number>): string {
  return [...wanted.keys()].sort().join(",");
}

function deliver(event: NostrEvent): void {
  const forAddress = listeners.get(event.pubkey);
  if (!forAddress) return;
  // Copy: a listener may unsubscribe itself while being notified (a call ending
  // on a `left` it just read), and mutating the live set mid-iteration would
  // skip its neighbour.
  for (const listener of [...forAddress]) {
    try {
      listener(event);
    } catch {
      // One malformed presence must not take the socket down.
    }
  }
}

function openReq(relayUrl: string, loop: RelayLoop): void {
  const authors = [...loop.wanted.keys()].sort();
  loop.live = authors.join(",");
  if (authors.length === 0) return;

  const filters: Filter[] = [{ kinds: [KIND_WRAP_EPHEMERAL], authors }];
  const sub = planeStream(relayUrl, filters, { pool: concordPool }).subscribe({
    next: (message) => {
      if (message.type === "event") {
        loop.attempt = 0;
        deliver(message.event);
      } else if (message.type === "eose") {
        // An ephemeral filter has no stored events, so EOSE means "connected
        // and listening" rather than "history done". It is the only signal that
        // the REQ was accepted, which is why the backoff resets here.
        loop.attempt = 0;
      } else {
        scheduleRetry(relayUrl, loop);
      }
    },
  });
  loop.stop = () => sub.unsubscribe();
}

function scheduleRetry(relayUrl: string, loop: RelayLoop): void {
  loop.stop?.();
  loop.stop = undefined;
  if (loop.wanted.size === 0) return;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** loop.attempt);
  loop.attempt += 1;
  clearTimeout(loop.retry);
  loop.retry = setTimeout(() => {
    if (loop.wanted.size === 0) return;
    openReq(relayUrl, loop);
  }, delay);
}

function resettle(relayUrl: string, loop: RelayLoop): void {
  clearTimeout(loop.settle);
  loop.settle = setTimeout(() => {
    const next = signatureOf(loop.wanted);
    if (next === loop.live && loop.stop) return;
    loop.stop?.();
    loop.stop = undefined;
    clearTimeout(loop.retry);
    if (loop.wanted.size === 0) {
      loops.delete(relayUrl);
      loop.live = "";
      return;
    }
    loop.attempt = 0;
    openReq(relayUrl, loop);
  }, SETTLE_MS);
}

/**
 * Listen for ephemeral wraps authored by `streamPks` on `relays`.
 *
 * Returns the release. Calling it twice is harmless; not calling it leaks one
 * refcount per address, which keeps a REQ open for the session.
 */
export function subscribeEphemeral(
  relays: readonly string[],
  streamPks: readonly string[],
  listener: EphemeralListener,
): () => void {
  const addresses = [...new Set(streamPks)];
  const urls = [...new Set(relays)];

  for (const pk of addresses) {
    let set = listeners.get(pk);
    if (!set) {
      set = new Set();
      listeners.set(pk, set);
    }
    set.add(listener);
  }

  for (const url of urls) {
    let loop = loops.get(url);
    if (!loop) {
      loop = { wanted: new Map(), live: "", attempt: 0 };
      loops.set(url, loop);
    }
    for (const pk of addresses) {
      loop.wanted.set(pk, (loop.wanted.get(pk) ?? 0) + 1);
    }
    resettle(url, loop);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const pk of addresses) {
      const set = listeners.get(pk);
      if (!set) continue;
      set.delete(listener);
      if (set.size === 0) listeners.delete(pk);
    }
    for (const url of urls) {
      const loop = loops.get(url);
      if (!loop) continue;
      for (const pk of addresses) {
        const count = (loop.wanted.get(pk) ?? 0) - 1;
        if (count > 0) loop.wanted.set(pk, count);
        else loop.wanted.delete(pk);
      }
      resettle(url, loop);
    }
  };
}

/** Test seam: drop every subscription and timer. */
export function _resetEphemeralForTests(): void {
  for (const [url, loop] of loops) {
    loop.stop?.();
    clearTimeout(loop.settle);
    clearTimeout(loop.retry);
    loops.delete(url);
  }
  listeners.clear();
}

/** Test seam: the addresses a relay's REQ is currently open for. */
export function _liveAddressesForTests(relayUrl: string): string[] {
  const loop = loops.get(relayUrl);
  if (!loop || !loop.stop) return [];
  return loop.live === "" ? [] : loop.live.split(",");
}
