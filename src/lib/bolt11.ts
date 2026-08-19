/**
 * The two BOLT11 fields zaps care about, decoded safely.
 *
 * A thin guard over applesauce's `parseBolt11`, which throws on a malformed
 * invoice and reports an amountless one as `0`. Callers here are verifying a
 * payment — a decode failure has to read as "cannot verify", never as a crash
 * mid-fold or a zero-sat zap.
 */

import { parseBolt11 } from "applesauce-common/helpers/bolt11";

export interface Bolt11Info {
  /** Millisats, or null for an amountless invoice. */
  amountMsats: number | null;
  /** Lowercase hex payment hash, or null when absent/undecodable. */
  paymentHash: string | null;
}

/** Decode an invoice's amount and payment hash. Never throws. */
export function bolt11Info(invoice: string): Bolt11Info {
  try {
    const { amount, paymentHash } = parseBolt11(invoice.trim());
    return {
      amountMsats:
        typeof amount === "number" && Number.isFinite(amount) && amount > 0
          ? amount
          : null,
      paymentHash: paymentHash ? paymentHash.toLowerCase() : null,
    };
  } catch {
    return { amountMsats: null, paymentHash: null };
  }
}

/** Whole sats an invoice encodes, or null (amountless/undecodable). */
export function bolt11AmountSats(invoice: string): number | null {
  const { amountMsats } = bolt11Info(invoice);
  return amountMsats === null ? null : Math.floor(amountMsats / 1000);
}
