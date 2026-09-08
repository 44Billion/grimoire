/**
 * Bitcoin transaction lookups behind kind-8333 on-chain zaps.
 *
 * Two stores, because the two outcomes of a lookup deserve different lifetimes:
 *
 *   - What the explorer SAID lands in Dexie (`onchainTxCache`), keyed by txid,
 *     so a transaction is fetched once per browser no matter how many events
 *     cite it, and survives a reload.
 *   - What went WRONG stays in memory. A transport failure is this session's
 *     network problem, not a fact about the transaction, and persisting it
 *     would let an outage hide a real zap after the outage ended.
 *
 * `subscribeAttempts` exists so a component can re-render when a lookup fails,
 * which is the one state change Dexie cannot report — there is nothing to
 * write.
 */

import db from "@/services/db";
import { EsploraNotFound, fetchEsploraTx } from "@/lib/esplora";

/** An unconfirmed transaction can still settle or be evicted, so it goes stale. */
const UNCONFIRMED_TTL = 60_000;
/**
 * How long a "no such transaction" answer is trusted.
 *
 * Not forever, even though a txid that never existed will not start existing.
 * The spec's flow is broadcast-then-publish, and relay propagation can beat an
 * explorer's index — so an 8333 read seconds after its transaction hit the
 * network can legitimately 404 once. Caching that as final would discard a
 * real zap permanently on this browser. Re-asking about a fabricated txid once
 * every ten minutes costs nothing; getting a genuine one wrong costs someone
 * their money's acknowledgement.
 */
const MISSING_TTL = 10 * 60_000;
/** Don't re-hammer a host that just refused, but do retry within a session. */
const FAILURE_COOLDOWN = 30_000;

export type AttemptState = "idle" | "pending" | "failed";

/** In-flight lookups, so N rows citing one transaction make one request. */
const inFlight = new Map<string, Promise<void>>();
/** `Date.now()` of the last transport failure per txid. */
const failures = new Map<string, number>();

type Listener = () => void;
const listeners = new Set<Listener>();

function ring(): void {
  for (const listener of listeners) listener();
}

/** Re-render on a lookup outcome that leaves nothing in Dexie to observe. */
export function subscribeAttempts(onChange: Listener): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Where a lookup stands right now.
 *
 * Read synchronously during render, alongside the Dexie row: a row plus
 * `"idle"` is a settled answer, no row plus `"pending"` is still verifying,
 * and no row plus `"failed"` is "we could not check", which the UI must not
 * render as a verdict.
 */
export function getAttemptState(txid: string): AttemptState {
  if (inFlight.has(txid)) return "pending";
  const failedAt = failures.get(txid);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_COOLDOWN) {
    return "failed";
  }
  return "idle";
}

async function lookup(txid: string): Promise<void> {
  try {
    const tx = await fetchEsploraTx(txid);
    await db.onchainTxCache.put({
      txid,
      confirmed: tx.confirmed ? 1 : 0,
      outputs: tx.outputs,
      missing: 0,
      fetchedAt: Date.now(),
    });
    failures.delete(txid);
  } catch (error) {
    if (error instanceof EsploraNotFound) {
      // There is no such transaction. That IS an answer, and a durable one —
      // a txid that never existed will not start existing — so it is cached,
      // and the zap citing it is discarded rather than re-queried forever.
      await db.onchainTxCache.put({
        txid,
        confirmed: 0,
        outputs: [],
        missing: 1,
        fetchedAt: Date.now(),
      });
      failures.delete(txid);
      return;
    }
    // Everything else — offline, timeout, 5xx — is this session's problem.
    failures.set(txid, Date.now());
  }
}

/**
 * Make sure the transaction is cached, fetching it if it is missing or stale.
 * Safe to call on every render: concurrent callers share one request, and a
 * confirmed transaction is never fetched twice.
 *
 * Returns the in-flight lookup, or `undefined` when there was nothing to do
 * (already running, or still cooling down after a failure). React callers
 * ignore it — they read the result back through Dexie — but a test can await
 * it instead of guessing how many microtasks a lookup takes.
 */
export function ensureOnchainTx(txid: string): Promise<void> | undefined {
  const running = inFlight.get(txid);
  if (running) return running;

  const failedAt = failures.get(txid);
  if (failedAt !== undefined && Date.now() - failedAt < FAILURE_COOLDOWN) {
    return undefined;
  }

  const promise = (async () => {
    const cached = await db.onchainTxCache.get(txid);
    if (cached) {
      // A mined transaction's outputs are immutable, so that row is final.
      // A mempool sighting and a 404 both age — for different reasons, hence
      // the two constants.
      if (cached.confirmed === 1) return;
      const ttl = cached.missing === 1 ? MISSING_TTL : UNCONFIRMED_TTL;
      if (Date.now() - cached.fetchedAt < ttl) return;
    }
    await lookup(txid);
  })()
    .catch(() => {
      // Dexie itself failed (private mode, quota). Nothing to record; the next
      // mount tries again.
      failures.set(txid, Date.now());
    })
    .finally(() => {
      inFlight.delete(txid);
      ring();
    });

  inFlight.set(txid, promise);
  ring();
  return promise;
}

/** Test seam: forget every in-memory attempt. Does not touch Dexie. */
export function resetOnchainTxAttempts(): void {
  inFlight.clear();
  failures.clear();
}
