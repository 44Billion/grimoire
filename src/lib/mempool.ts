/**
 * mempool.space links and its Esplora REST root.
 *
 * A leaf module on purpose — it imports nothing, so `nip73-helpers` can reach
 * for it without pulling a dependency graph into a file that every renderer
 * touches.
 */

/** Esplora-compatible REST root. mempool.space is also what the UI links to. */
export const MEMPOOL_ESPLORA_API = "https://mempool.space/api";

/** 64 lowercase hex characters, the only txid shape that reaches a URL here. */
const TXID_RE = /^[0-9a-f]{64}$/;

export function isTxid(value: string): boolean {
  return TXID_RE.test(value);
}

/**
 * A mainnet transaction's page.
 *
 * No network parameter, deliberately: the callers that must never leave
 * mainnet — NIP-73 `bitcoin:tx:` identifiers and kind 8333, which the spec
 * scopes to mainnet only — get a function that structurally cannot. The
 * wallet, which does have a network, calls {@link getMempoolUrl}.
 */
export function getMempoolTxUrl(txid: string): string {
  return `https://mempool.space/tx/${txid}`;
}

/** A transaction's page on whichever network the wallet is connected to. */
export function getMempoolUrl(txid: string, network?: string): string {
  const baseUrl =
    network === "testnet"
      ? "https://mempool.space/testnet"
      : network === "signet"
        ? "https://mempool.space/signet"
        : "https://mempool.space";
  return `${baseUrl}/tx/${txid}`;
}
