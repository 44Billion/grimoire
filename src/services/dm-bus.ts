/**
 * The DM doorbell — a notification bus, not a data channel.
 *
 * Same shape and same reasoning as `src/lib/concord/wire-bus.ts`: a rumor is
 * written to Dexie FIRST, and this then names WHICH conversation changed so
 * mounted views re-read the store. The store stays the single source of truth,
 * so a missed ring costs a stale render until the next one, never a lost
 * message. Get that order backwards and the reverse becomes possible.
 *
 * Two scopes:
 *
 * - `dm:<conversationId>` — that conversation's rows changed
 * - `dm:list` — the set of conversations, or their ordering, changed
 *
 * Emissions coalesce, so a backfill writing hundreds of rumors produces one
 * re-read rather than hundreds.
 *
 * A near-copy of the Concord bus rather than a shared one, deliberately for
 * now: that module is Concord's by name and by docstring, and pulling a
 * coalescing primitive out from under a working subsystem is its own change.
 */

export type DmScope = string;

/** One conversation's rows changed. */
export const conversationScope = (conversationId: string): DmScope =>
  `dm:${conversationId}`;

/** The conversation list changed — a new correspondent, or a reordering. */
export const DM_LIST_SCOPE: DmScope = "dm:list";

type DmListener = (scopes: ReadonlySet<DmScope>) => void;

/** Coalescing window (ms). The Concord bus's value, for the same reason. */
const FLUSH_MS = 50;

const listeners = new Set<DmListener>();
let pending = new Set<DmScope>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  timer = undefined;
  if (pending.size === 0) return;
  const batch = pending;
  pending = new Set();
  for (const listener of listeners) {
    try {
      listener(batch);
    } catch {
      // One throwing listener must not silence live delivery for the rest.
    }
  }
}

/** Announce that these conversations changed. Coalesced. */
export function emitDmScopes(scopes: Iterable<DmScope>): void {
  for (const s of scopes) pending.add(s);
  if (pending.size > 0 && timer === undefined)
    timer = setTimeout(flush, FLUSH_MS);
}

/** Subscribe to every announcement. Returns an unsubscribe. */
export function onDmScopes(listener: DmListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to one scope — the common case. */
export function onDmScope(scope: DmScope, listener: () => void): () => void {
  return onDmScopes((scopes) => {
    if (scopes.has(scope)) listener();
  });
}

/** Test seam: drop any pending batch and every listener. */
export function _resetDmBusForTests(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  pending = new Set();
  listeners.clear();
}
