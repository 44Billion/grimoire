/**
 * Live progress from an agent, on wraps a relay must not store.
 *
 * A delta is a fragment of a turn that has not finished yet: text as the model
 * writes it, reasoning as it thinks, a tool call as it is decided. It rides kind
 * 21059 — the ephemeral gift wrap — so a relay forwards it and keeps nothing, and
 * everything it carried is repeated in the turn that closes it. That makes this
 * the opposite of the durable path in every way that matters:
 *
 * - Nothing is written to Dexie. A delta that outlived the turn it described
 *   would be a second, worse copy of history.
 * - It gets its OWN subscription rather than a `WRAP_KINDS` entry, because a
 *   21059 reaching the durable ingest would be filed as a rumor.
 * - A missed delta is simply gone, and there is nothing to page or catch up.
 *
 * One REQ per relay whatever the caller count, filtered by the reader's own `p`
 * tag — which is all a relay can be asked, since everything that says WHICH
 * session a delta belongs to is inside the seal. Arrivals are demultiplexed here,
 * after decryption, by the address in the rumor.
 *
 * Reads the account's own inbox, so it stays on the singleton pool and
 * authenticates: this is your mailbox, unlike a publish, which must not be
 * attributable. See CLAUDE.md, exception 2.
 */

import type { Filter, NostrEvent } from "nostr-tools";
import { unlockGiftWrap } from "applesauce-common/helpers/gift-wrap";
import type { Rumor as WrapRumor } from "applesauce-common/helpers/gift-wrap";

import pool from "@/services/relay-pool";
import { authenticateDmRelays } from "@/services/dm-read-auth";
import { KIND_DELTA } from "@/lib/agent-session/kinds";
import { parseAgentEvent } from "@/lib/agent-session/decode";
import { DeltaBuffer } from "@/lib/agent-session/buffer";
import type { DecodedDelta, Rumor } from "@/lib/agent-session/types";

/** The ephemeral wrap. NIP-59's own kind, one class up. */
export const KIND_WRAP_EPHEMERAL = 21059;

/** Called with every delta that opened and verified, for any session. */
export type DeltaListener = (delta: DecodedDelta) => void;

interface Signer {
  nip44?: {
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
  };
}

interface Watch {
  stop: () => void;
  listeners: Set<DeltaListener>;
  /** Live text per session, so a window opening mid-turn is not blank. */
  buffers: Map<string, DeltaBuffer>;
  /** Relays already being read, so joining with more adds only the new ones. */
  relays: Set<string>;
  /** Open one more REQ, for a session whose deltas go somewhere new. */
  extend: (relays: string[]) => void;
}

const watches = new Map<string, Watch>();

/**
 * Wrap ids already opened, bounded and FIFO.
 *
 * Without an `eventStore` on the subscription applesauce does no cross-relay
 * dedupe, so four inbox relays hand over every wrap four times — and each
 * duplicate costs a NIP-44 decryption through the signer. At delta rates against
 * an extension that is a prompt storm, or at best four times the work.
 */
const MAX_SEEN = 4_000;

function makeSeen() {
  const ids = new Set<string>();
  const order: string[] = [];
  return {
    admit(id: string): boolean {
      if (ids.has(id)) return false;
      ids.add(id);
      order.push(id);
      if (order.length > MAX_SEEN) {
        const oldest = order.shift();
        if (oldest) ids.delete(oldest);
      }
      return true;
    },
  };
}

/**
 * The filter, which cannot say what it wants.
 *
 * `#p` and the kind, and nothing else: the session address lives inside the
 * seal, and minting an indexable tag for it would tell the relay which agent is
 * working for whom and when — the exact metadata the wrap exists to hide.
 *
 * NO `since`. A wrap's `created_at` is the publisher's to choose, and an
 * ephemeral one is dated now only because relays reject a backdated one; a `since`
 * of `now` would still race the clock skew between two machines and drop the very
 * events this exists to deliver.
 */
function deltaFilter(viewer: string): Filter {
  return { kinds: [KIND_WRAP_EPHEMERAL], "#p": [viewer] };
}

/**
 * Start watching, or join the watch already running for this account.
 *
 * Refcounted: the last listener out closes the REQ. Returns the current buffers
 * so a window that opens mid-turn paints what has already arrived.
 */
export function subscribeDeltas(
  viewer: string,
  relays: string[],
  signer: Signer,
  listener: DeltaListener,
): { stop: () => void; buffers: Map<string, DeltaBuffer> } {
  let watch = watches.get(viewer);

  if (!watch) {
    const listeners = new Set<DeltaListener>();
    const buffers = new Map<string, DeltaBuffer>();
    const seen = makeSeen();
    const open_: (() => void)[] = [];
    const reading = new Set<string>();

    const read = (where: string[]) => {
      const fresh = where.filter((url) => !reading.has(url));
      if (fresh.length === 0) return;
      for (const url of fresh) reading.add(url);

      // Authenticate, the same way the durable inbox read does: a relay that
      // wants NIP-42 answers a REQ for your own wraps with nothing at all until
      // you have, and says so only in a CLOSED nobody is listening for.
      const auth = authenticateDmRelays(fresh);
      const subscription = pool
        .subscription(fresh, [deltaFilter(viewer)], { eventStore: null })
        .subscribe({
          next: (wrap: NostrEvent) => {
            if (!seen.admit(wrap.id)) return;
            void open(wrap, signer).then((delta) => {
              if (!delta) return;
              const key = `${delta.session.agent}:${delta.session.session}`;
              let buffer = buffers.get(key);
              if (!buffer) {
                buffer = new DeltaBuffer();
                buffers.set(key, buffer);
              }
              buffer.apply(delta);
              for (const each of listeners) each(delta);
            });
          },
          error: (error: unknown) => {
            // Ephemeral traffic is worthless once missed, so there is no
            // catch-up to rush back for — but a session in progress goes blind,
            // so it is said out loud rather than swallowed.
            console.warn("[agent] the delta watch stopped:", error);
          },
        });

      open_.push(() => {
        subscription.unsubscribe();
        auth.unsubscribe();
      });
    };

    read(relays);

    watch = {
      listeners,
      buffers,
      relays: reading,
      extend: read,
      stop: () => {
        for (const close of open_) close();
      },
    };
    watches.set(viewer, watch);
  } else {
    // A session whose head names relays this watch is not reading yet.
    watch.extend(relays);
  }

  watch.listeners.add(listener);
  const current = watch;

  return {
    buffers: current.buffers,
    stop: () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) {
        current.stop();
        watches.delete(viewer);
      }
    },
  };
}

/**
 * Open one wrap into the delta it carries, or nothing.
 *
 * The authorship proof is the SEAL, never the wrap — a wrap is signed by a
 * throwaway key by design, so its signature says nothing about who wrote the
 * words. `unlockGiftWrap` throws when the seal's author and the rumor's disagree
 * ("Seal author does not match rumor author"), which is the check that stops
 * someone relaying another agent's progress as their own; `parseAgentEvent` then
 * refuses anything whose author is not the agent named in its own address.
 *
 * A null is ordinary and not worth a log line: an inbox holds wraps for keys we
 * do not have, and most of what arrives is not a delta at all.
 */
async function open(
  wrap: NostrEvent,
  signer: Signer,
): Promise<DecodedDelta | null> {
  if (!signer.nip44) return null;
  try {
    const rumor = (await unlockGiftWrap(wrap, signer as never)) as WrapRumor;
    if (rumor.kind !== KIND_DELTA) return null;
    const decoded = parseAgentEvent(rumor as unknown as Rumor);
    return decoded?.type === "delta" ? decoded : null;
  } catch {
    return null;
  }
}

/** Test seam: forget every watch, so one test cannot leak into the next. */
export function _resetDeltaWatches(): void {
  for (const watch of watches.values()) watch.stop();
  watches.clear();
}
