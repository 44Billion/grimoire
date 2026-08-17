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
import type { PlaneReadOutcome } from "@/lib/concord/plane-request";
import { planeStream } from "@/lib/concord/plane-request";
import { whenAuthAnswered } from "@/lib/concord/plane-sync";
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
 * How long a subscription must survive to have earned a prompt retry.
 *
 * The backoff is reset on ROUND DURATION, never on EOSE — the same discipline
 * `concord-wire.ts` arrived at, and for a sharper reason here. An ephemeral
 * filter matches nothing stored, so EOSE arrives immediately and always; a relay
 * that EOSEs and then closes (`close-after-eose`, a behaviour real enough that
 * `src/test/mock-relay.ts` models it) would reset the counter on every cycle and
 * pin the retry at one REQ per second, per relay, forever, with nothing logged.
 */
const HEALTHY_ROUND_MS = 60_000;

/** The tunables, so a test can watch a backoff climb without waiting minutes. */
const knobs = {
  retryBaseMs: RETRY_BASE_MS,
  retryMaxMs: RETRY_MAX_MS,
  healthyRoundMs: HEALTHY_ROUND_MS,
};

/** Test seam: shorten the retry clock. */
export function _configureEphemeralForTests(over: Partial<typeof knobs>): void {
  Object.assign(knobs, over);
}

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
  /** When the live subscription was opened, for the healthy-round reset. */
  startedAt: number;
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
  loop.startedAt = Date.now();
  const sub = planeStream(relayUrl, filters, { pool: concordPool }).subscribe({
    next: (message) => {
      if (message.type === "event") {
        deliver(message.event);
      } else if (message.type === "ended") {
        void endRound(relayUrl, loop, message.outcome);
      }
      // EOSE is deliberately ignored. An ephemeral filter matches nothing
      // stored, so it says "connected", not "caught up" — and treating it as
      // progress is what turns a close-after-eose relay into a retry loop.
    },
  });
  loop.stop = () => sub.unsubscribe();
}

async function endRound(
  relayUrl: string,
  loop: RelayLoop,
  outcome: PlaneReadOutcome,
): Promise<void> {
  loop.stop?.();
  loop.stop = undefined;
  if (loop.wanted.size === 0) return;

  if (outcome === "refused") {
    // The relay gates 1059/21059 and turned us away — routine on a first REQ,
    // which races the NIP-42 challenge on a socket it opened itself. Retrying
    // straight into a refusal is the flood the wire already paid for once.
    await whenAuthAnswered(relayUrl, [...loop.wanted.keys()]);
    if (loop.wanted.size === 0) return;
  }

  // A subscription that lived a while earned a prompt retry; a relay slamming
  // the door backs off.
  if (Date.now() - loop.startedAt > knobs.healthyRoundMs) loop.attempt = 0;
  const delay = Math.min(
    knobs.retryMaxMs,
    knobs.retryBaseMs * 2 ** loop.attempt,
  );
  loop.attempt += 1;
  clearTimeout(loop.retry);
  loop.retry = setTimeout(
    () => {
      if (loop.wanted.size === 0) return;
      openReq(relayUrl, loop);
    },
    // Jittered so a relay serving several tabs does not get every reconnect at
    // the same instant.
    delay + Math.floor(Math.random() * (delay / 4)),
  );
}

function resettle(relayUrl: string, loop: RelayLoop): void {
  clearTimeout(loop.settle);
  loop.settle = setTimeout(() => {
    const next = signatureOf(loop.wanted);
    const changed = next !== loop.live;
    if (!changed && loop.stop) return;
    loop.stop?.();
    loop.stop = undefined;
    clearTimeout(loop.retry);
    if (loop.wanted.size === 0) {
      loops.delete(relayUrl);
      loop.live = "";
      return;
    }
    // Only a genuinely different address set earns a fresh budget. Opening and
    // closing a window while a dead relay is backing off is churn, not news,
    // and letting it zero the counter reopens at 50ms forever.
    if (changed) loop.attempt = 0;
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
      loop = { wanted: new Map(), live: "", attempt: 0, startedAt: 0 };
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

/** Test seam: drop every subscription and timer, and restore the retry clock. */
export function _resetEphemeralForTests(): void {
  Object.assign(knobs, {
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS,
    healthyRoundMs: HEALTHY_ROUND_MS,
  });
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
