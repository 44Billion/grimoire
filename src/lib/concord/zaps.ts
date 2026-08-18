/**
 * Private zaps on Chat Plane messages (CORD.md §"Private Zaps").
 *
 * Ported from armada `src/lib/zaps.ts`, CORD half only — the NIP-57 tally over
 * public kind-9735 receipts stays where it is (`src/lib/zaps`-free; grimoire's
 * public zaps go through `ZapWindow`).
 *
 * NIP-57 attests a zap with a receipt signed by the RECIPIENT'S LNURL provider
 * and published to relays. Inside a sealed plane that is wrong three times
 * over: the receipt is public, it names recipient, amount, time and the zapped
 * id, and no provider can seal anything into a plane it cannot see. So the
 * attestation moves to the payer, who is already in the room: a Lightning
 * payment's preimage is its own proof, and `sha256(preimage)` is the invoice's
 * payment hash. The payer seals invoice + preimage as a kind-9735 rumor and
 * every member checks the math locally.
 *
 * Everything here is pure and synchronous, so the fold can verify inline.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { bolt11Info } from "@/lib/bolt11";
import { KIND_ZAP } from "@/lib/concord/kinds";

/** One verified zap on a message. */
export interface ZapEntry {
  /** The zap rumor's id. */
  id: string;
  /** The payer — the seal's signer, not a provider. */
  pubkey: string;
  /**
   * Who the payer says they paid (the `p` tag).
   *
   * The payer's word, carried by their signature on the seal: an invoice does
   * not name its account holder, so no proof binds a payment to a pubkey. It is
   * backed by economics rather than cryptography — faking a zap means actually
   * paying the sats to someone (CORD.md §4).
   */
  recipient: string;
  sats: number;
  comment: string;
  /** The zap rumor's `created_at`, so a reader can place it in time. */
  createdAt: number;
}

/**
 * Verify a zap rumor's payment proof (CORD.md §4):
 *   - `sha256(preimage)` equals the invoice's payment hash, and
 *   - the `amount` tag equals the invoice's own amount, in millisats.
 *
 * Returns the payment hash on success — the fold dedupes on it, so one settled
 * payment counts at most once per channel — and null on any failure. Channel
 * and epoch binding is the plane decoder's job (it checks every chat rumor);
 * this checks only what is zap-specific. Never throws.
 */
export function verifyZapRumor(rumor: {
  kind: number;
  tags: string[][];
}): string | null {
  if (rumor.kind !== KIND_ZAP) return null;
  const find = (name: string) => rumor.tags.find((t) => t[0] === name)?.[1];
  const bolt11 = find("bolt11");
  const preimage = find("preimage");
  const amount = Number(find("amount"));
  if (!bolt11 || !preimage || !/^[0-9a-f]{64}$/.test(preimage)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const { amountMsats, paymentHash } = bolt11Info(bolt11);
  // An amountless invoice is not zappable: there would be nothing to check the
  // `amount` tag against.
  if (!paymentHash || amountMsats === null) return null;
  if (amountMsats !== amount) return null;
  try {
    return bytesToHex(sha256(hexToBytes(preimage))) === paymentHash
      ? paymentHash
      : null;
  } catch {
    return null;
  }
}

/**
 * The zap rumor's own tags. The `channel`/`epoch`/`ms` binding tags every chat
 * rumor carries are added by the send path; `omitTarget` skips the `e` tag for
 * a sender whose transport appends the target itself.
 */
export function zapRumorTags(opts: {
  targetId: string;
  targetKind: number;
  recipient: string;
  amountMsats: number;
  bolt11: string;
  preimage: string;
  omitTarget?: boolean;
}): string[][] {
  return [
    ...(opts.omitTarget ? [] : [["e", opts.targetId]]),
    ["p", opts.recipient],
    ["k", String(opts.targetKind)],
    ["amount", String(opts.amountMsats)],
    ["bolt11", opts.bolt11],
    ["preimage", opts.preimage],
  ];
}
