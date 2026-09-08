/**
 * Esplora transaction lookups, for verifying kind-8333 on-chain zaps.
 *
 * mempool.space is tried first, because it is also what the UI links to: a
 * reader who follows the tx link lands on the same data the amount was
 * computed from. blockstream.info backs it up, and that is not
 * belt-and-braces — the first live test of this code got a 503 from
 * mempool.space and then a hard timeout, while blockstream answered 200 for
 * the same transaction. With one host, an on-chain zap reads as `unverified`
 * whenever that host is having a bad afternoon.
 *
 * The order matters for privacy as well as latency: the fallback is only
 * reached when the first host failed, so in the ordinary case exactly one
 * party learns which transaction was looked up, and it is the one the reader
 * can see named in the link.
 */

import { MEMPOOL_ESPLORA_API, isTxid } from "@/lib/mempool";
import type { OnchainZapOutput } from "@/lib/onchain-zap";

/**
 * Esplora REST roots, in the order they are tried. Both index Bitcoin
 * mainnet, so they answer identically when they answer at all.
 */
const ESPLORA_HOSTS = [MEMPOOL_ESPLORA_API, "https://blockstream.info/api"];

/** How long to wait on ONE host before moving to the next. */
const TIMEOUT_MS = 8_000;

/** A transaction, reduced to what verification needs. */
export interface EsploraTx {
  txid: string;
  /** Mined. An unconfirmed transaction can still be evicted (RBF, double-spend). */
  confirmed: boolean;
  outputs: OnchainZapOutput[];
}

/**
 * The node says this transaction does not exist.
 *
 * Distinct from a transport failure on purpose, and the distinction is the
 * whole reason this class exists: "there is no such transaction" is grounds to
 * discard the zap, while "we could not reach the explorer" must never be
 * allowed to look like grounds for anything. Conflating them turns an outage
 * into an accusation.
 */
export class EsploraNotFound extends Error {
  constructor(txid: string) {
    super(`Transaction not found: ${txid}`);
    this.name = "EsploraNotFound";
  }
}

interface EsploraVoutJson {
  scriptpubkey_address?: unknown;
  value?: unknown;
}

/** One host's answer. Throws on anything that should be retried elsewhere. */
async function fetchFromHost(
  host: string,
  txid: string,
  signal?: AbortSignal,
): Promise<EsploraTx> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(`${host}/tx/${txid}`, { signal: combined });

  if (response.status === 404) throw new EsploraNotFound(txid);
  if (!response.ok) {
    throw new Error(`Esplora ${host} returned ${response.status}`);
  }

  const json: unknown = await response.json();
  if (typeof json !== "object" || json === null) {
    throw new Error(`Esplora ${host} returned no transaction`);
  }

  const body = json as { status?: { confirmed?: unknown }; vout?: unknown };
  const vout = Array.isArray(body.vout) ? (body.vout as EsploraVoutJson[]) : [];

  return {
    txid,
    confirmed: body.status?.confirmed === true,
    outputs: vout.map((out) => ({
      // An output with no address form — OP_RETURN, a bare script — pays
      // nobody a verification can name, and `verifyAgainstOutputs` skips it.
      ...(typeof out.scriptpubkey_address === "string"
        ? { address: out.scriptpubkey_address }
        : {}),
      value: typeof out.value === "number" ? out.value : 0,
    })),
  };
}

/**
 * Fetch one transaction, trying each host in turn.
 *
 * Throws {@link EsploraNotFound} on a 404 and a plain `Error` when no host
 * could answer — a timeout, an offline browser, a 5xx, unparseable JSON.
 *
 * A 404 does NOT fail over. Both hosts index the same chain, so one saying the
 * transaction does not exist is an answer, not a malfunction, and asking again
 * elsewhere would only widen who learns the txid.
 */
export async function fetchEsploraTx(
  txid: string,
  signal?: AbortSignal,
): Promise<EsploraTx> {
  // Checked before it reaches the URL: nothing derived from tag data may shape
  // a request path, the same rule `payto.ts` states for URI schemes.
  if (!isTxid(txid)) throw new Error(`Not a transaction id: ${txid}`);

  let lastError: unknown;
  for (const host of ESPLORA_HOSTS) {
    try {
      return await fetchFromHost(host, txid, signal);
    } catch (error) {
      if (error instanceof EsploraNotFound) throw error;
      // The caller's own abort is not a host problem; retrying it elsewhere
      // would ignore what the caller asked for.
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw new Error(`No Esplora host could answer for ${txid}`, {
    cause: lastError,
  });
}
