/**
 * Nostr pubkey → Bitcoin Taproot (P2TR) address.
 *
 * Nostr and Taproot share a key format: both are 32-byte x-only secp256k1
 * keys (BIP-340 / BIP-341). So a pubkey needs no conversion to serve as a
 * Taproot INTERNAL key — `p2tr` applies the BIP-341 TapTweak and bech32m-
 * encodes the result as a witness-v1 output. That is the whole reason kind
 * 8333 works without a recipient publishing anything: every Nostr identity
 * already owns an address.
 *
 * Mainnet only, deliberately. The kind-8333 spec puts testnet and signet out
 * of scope, and offering a network parameter here would invite a caller to
 * derive an address the spec forbids.
 */

import { hexToBytes } from "@noble/hashes/utils.js";
// Type-only, so it is erased at build and the runtime import below stays lazy.
import type * as BtcSignerModule from "@scure/btc-signer";

/**
 * `@scure/btc-signer` is ~150 kB and only this module needs it, so it is
 * loaded on demand — every caller is already async, having a transaction to
 * fetch. Keeps it out of the entry bundle.
 */
let btcModule: Promise<typeof BtcSignerModule> | undefined;

function loadBtc(): Promise<typeof BtcSignerModule> {
  // eslint-disable-next-line grimoire/no-inline-dynamic-import -- keeps @scure/btc-signer out of the entry bundle, as the comment above says
  btcModule ??= import("@scure/btc-signer");
  return btcModule;
}

/**
 * Derivation is deterministic, and one channel resolves the same handful of
 * recipients over and over, so the answer is worth keeping. Unbounded is
 * fine: the key set is the set of pubkeys the reader has seen zapped.
 */
const derived = new Map<string, string | null>();

/**
 * Accepts either case — a pubkey is a number, and a publisher writing it in
 * uppercase has not written a different key. (A *txid* is a different matter:
 * the spec pins those to lowercase, and `isTxid` in `@/lib/mempool` enforces
 * it.)
 */
const PUBKEY_RE = /^[0-9a-fA-F]{64}$/;

/**
 * The mainnet `bc1p…` address for a 32-byte hex pubkey, or `null` when the
 * input is not one — malformed, or a value that is not a point on the curve.
 * Never throws: this runs over relay data, where a bad `p` tag is a Tuesday.
 */
export async function deriveTaprootAddress(
  pubkeyHex: string,
): Promise<string | null> {
  if (typeof pubkeyHex !== "string" || !PUBKEY_RE.test(pubkeyHex)) return null;
  const key = pubkeyHex.toLowerCase();

  const cached = derived.get(key);
  if (cached !== undefined) return cached;

  const address = await (async () => {
    try {
      const btc = await loadBtc();
      // `hexToBytes` only accepts lowercase, hence the normalisation above.
      return btc.p2tr(hexToBytes(key), undefined, btc.NETWORK).address ?? null;
    } catch {
      // `p2tr` rejects a non-Schnorr pubkey. That is a malformed `p` tag, not
      // an error worth surfacing — the caller reads `null` as "no address to
      // match against the transaction".
      return null;
    }
  })();

  derived.set(key, address);
  return address;
}

/**
 * Derive several at once, skipping anything malformed. The returned map is
 * keyed by the lowercased pubkey, so a caller can look up by either case
 * after normalising.
 */
export async function deriveTaprootAddresses(
  pubkeys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    pubkeys.map(async (pk) => {
      const address = await deriveTaprootAddress(pk);
      if (address) out.set(pk.toLowerCase(), address);
    }),
  );
  return out;
}
