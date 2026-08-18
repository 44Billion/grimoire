import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * Shared mock for applesauce's `parseBolt11`: `lnmock<msats>[:x][:h<hash>]`
 * decodes to controlled fields (`:x` = amountless, `:h` = an explicit payment
 * hash, default {@link MOCK_PAYMENT_HASH}, which {@link MOCK_PREIMAGE}
 * settles). Anything else falls through to the real decoder, so a test can
 * still assert against a genuine BOLT11 vector.
 *
 * Signing a real invoice per case is not possible offline, and the proof a zap
 * rests on is `sha256(preimage) == payment_hash` — a relation the mock states
 * exactly.
 */

export const MOCK_PREIMAGE = "11".repeat(32);
export const MOCK_PAYMENT_HASH = bytesToHex(sha256(hexToBytes(MOCK_PREIMAGE)));

/** The payment hash a given preimage settles. */
export function paymentHashOf(preimage: string): string {
  return bytesToHex(sha256(hexToBytes(preimage)));
}

/** `lnmock…` invoice string for an amount in millisats. */
export function mockInvoice(
  amountMsats: number,
  opts?: { amountless?: boolean; paymentHash?: string },
): string {
  const parts = [String(amountMsats)];
  if (opts?.amountless) parts.push("x");
  if (opts?.paymentHash) parts.push(`h${opts.paymentHash}`);
  return `lnmock${parts.join(":")}`;
}

export function mockParseBolt11(
  actual: typeof import("applesauce-common/helpers/bolt11"),
) {
  return {
    ...actual,
    parseBolt11: (invoice: string) => {
      if (!invoice.startsWith("lnmock")) return actual.parseBolt11(invoice);
      const parts = invoice.slice("lnmock".length).split(":");
      const paymentHash =
        parts.find((p) => p.startsWith("h"))?.slice(1) ?? MOCK_PAYMENT_HASH;
      return {
        paymentRequest: invoice,
        description: "",
        amount: parts.includes("x") ? 0 : Number(parts[0]),
        timestamp: 0,
        expiry: 3600,
        paymentHash,
      };
    },
  };
}
