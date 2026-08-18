/**
 * The zap payment pipeline, shared by both zap surfaces.
 *
 * Resolve a Lightning address, fetch an invoice, pay it, and hand the result
 * back. The two modes differ in exactly three places, all of them here:
 *
 * - **Public (NIP-57)**: a signed kind-9734 rides the LNURL callback's `nostr`
 *   parameter — never published by us — and the provider's public kind-9735
 *   receipt IS the announcement. The comment may go to the provider too.
 * - **Private (CORD.md)**: no `nostr` parameter (its presence is what makes a
 *   provider mint a public receipt), no comment to the provider, and the
 *   payment must return its **preimage** — that is the proof the sealed
 *   announcement carries instead of a provider's signature. `onSettled` is
 *   where the caller seals it.
 *
 * A rejected `pay_invoice` is NOT a failed payment: NWC acks get lost and
 * wallets reply error-shaped for payments that settle a beat later. So every
 * uncertain outcome is resolved by asking the wallet's own ledger through
 * `lookup_invoice` before anything is reported as a failure.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { useCallback, useRef, useState } from "react";

import { useWallet } from "@/hooks/useWallet";
import { bolt11Info } from "@/lib/bolt11";
import {
  createZapRequest,
  serializeZapRequest,
  type EmojiTag,
} from "@/lib/create-zap-request";
import { fetchInvoiceFromCallback, validateZapSupport } from "@/lib/lnurl";

import type { ZapPayment } from "@/lib/chat/adapters/base-adapter";
import type { LnUrlPayResponse } from "@/lib/lnurl";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";
import type { ISigner } from "applesauce-signers";

/** How far a payment has got. */
export type ZapStatus =
  | "idle"
  | "resolving"
  | "paying"
  /** An invoice is on screen for an external wallet to pay. */
  | "manual"
  | "paid";

/**
 * What a zap ended as.
 *
 * - `"paid"` — settled, and recorded (the provider's receipt is on its way, or
 *   the private announcement is sealed).
 * - `"manual"` — the invoice was surfaced for an external wallet; nothing has
 *   been paid yet as far as this client knows.
 * - `"unproven"` — a PRIVATE zap whose payment settled but whose wallet has not
 *   surfaced the preimage the announcement needs. The sats reached the
 *   recipient; there is just nothing to seal yet. Never a failure.
 */
export type ZapOutcome = "paid" | "manual" | "unproven";

/**
 * How a zap attempt ended, with the invoice it produced.
 *
 * The invoice comes back rather than being read off state: a caller that has to
 * show a QR needs it in the same turn, and a `setState` is not visible there.
 */
export interface ZapResult {
  outcome: ZapOutcome;
  bolt11: string;
}

export interface ZapAttempt {
  amountSats: number;
  comment?: string;
  emojiTags?: EmojiTag[];
  /** Public mode only: sign the request with a throwaway key. */
  anonymousSigner?: ISigner;
  /** Whether to pay with the connected NWC wallet, or fall back to a QR. */
  withWallet: boolean;
}

export interface UseZapPaymentOptions {
  recipientPubkey: string;
  /** Resolved LNURL-pay params for the recipient (from `useLnurlCache`). */
  lnurlData: LnUrlPayResponse | undefined;
  /** The recipient's `lud16`, carried into the kind-9734's `lnurl` tag. */
  lightningAddress?: string;
  /** Public-mode context for the kind-9734. */
  publicContext?: {
    eventPointer?: EventPointer;
    addressPointer?: AddressPointer;
    customTags?: string[][];
    relays?: string[];
  };
  /**
   * Private mode: publish the settled payment as this protocol's own zap.
   * Its presence selects the private flow — see the module docstring.
   */
  onSettled?: (payment: ZapPayment) => Promise<void>;
}

/** How long a `pay_invoice` may hang before we go asking the ledger instead. */
const PAY_TIMEOUT_MS = 30_000;
/** Rounds of `lookup_invoice` while a payment is still resolving. */
const RECOVER_ATTEMPTS = 5;
const RECOVER_FIRST_DELAY_MS = 500;
const RECOVER_DELAY_MS = 1_500;
/** How long to keep asking for a missing preimage in the background. */
const LATE_PREIMAGE_BUDGET_MS = 120_000;
const LATE_PREIMAGE_DELAY_MS = 5_000;

/** What the wallet's ledger could establish about a payment. */
type Recovery =
  /** It settled. `preimage` is null when the wallet will not surface one. */
  | { state: "settled"; preimage: string | null }
  /** The wallet says it failed. */
  | { state: "failed" }
  /** Undecidable within the budget (lookup unsupported, pending, erroring). */
  | { state: "unknown" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useZapPayment(opts: UseZapPaymentOptions) {
  const {
    recipientPubkey,
    lnurlData,
    lightningAddress,
    publicContext,
    onSettled,
  } = opts;
  const isPrivate = Boolean(onSettled);
  const { payInvoice, lookupInvoice, walletMethods } = useWallet();

  const [status, setStatus] = useState<ZapStatus>("idle");
  const [invoice, setInvoice] = useState<string>("");
  /** Live across renders so a late preimage can still be sealed. */
  const pending = useRef<{ bolt11: string; payment: ZapPayment } | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setInvoice("");
    pending.current = null;
  }, []);

  /**
   * Ask the wallet what actually happened to a payment whose reply was missing,
   * error-shaped, or preimage-less. The ledger is the honest narrator here: a
   * just-settled payment can report `pending` for a moment, and a settled one
   * can briefly omit its preimage, so this polls rather than asking once.
   */
  const recover = useCallback(
    async (
      bolt11: string,
      schedule = {
        attempts: RECOVER_ATTEMPTS,
        firstDelayMs: RECOVER_FIRST_DELAY_MS,
        delayMs: RECOVER_DELAY_MS,
      },
    ): Promise<Recovery> => {
      if (!walletMethods.includes("lookup_invoice"))
        return { state: "unknown" };
      const { paymentHash } = bolt11Info(bolt11);
      let settled = false;
      for (let attempt = 0; attempt < schedule.attempts; attempt++) {
        await sleep(attempt === 0 ? schedule.firstDelayMs : schedule.delayMs);
        try {
          const tx = await lookupInvoice(paymentHash ?? undefined, bolt11);
          if (tx?.state === "settled") {
            if (tx.preimage) return { state: "settled", preimage: tx.preimage };
            // Keep polling — the preimage may surface a round later.
            settled = true;
          }
          if (tx?.state === "failed" || tx?.state === "expired") {
            return { state: "failed" };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message.toLowerCase() : "";
          // A wallet that cannot look invoices up will never answer; stop asking.
          if (
            message.includes("not supported") ||
            message.includes("unsupported") ||
            message.includes("not_implemented")
          ) {
            break;
          }
          // Transient lookup error — try again.
        }
      }
      return settled
        ? { state: "settled", preimage: null }
        : { state: "unknown" };
    },
    [lookupInvoice, walletMethods],
  );

  /**
   * Seal a payment whose preimage arrived late (or by hand). Safe to call once
   * the zap has already been reported as `"unproven"`.
   */
  const recordPreimage = useCallback(
    async (preimage: string): Promise<void> => {
      const held = pending.current;
      if (!held || !onSettled) return;
      const normalized = preimage.trim().toLowerCase();
      const { paymentHash } = bolt11Info(held.bolt11);
      if (!/^[0-9a-f]{64}$/.test(normalized)) {
        throw new Error("A preimage is 64 hex characters.");
      }
      if (!paymentHash) throw new Error("Could not read the invoice.");
      if (bytesToHex(sha256(hexToBytes(normalized))) !== paymentHash) {
        throw new Error("That preimage does not match this invoice.");
      }
      await onSettled({ ...held.payment, preimage: normalized });
      pending.current = null;
      setStatus("paid");
    },
    [onSettled],
  );

  /**
   * Pay one invoice and, in private mode, seal the proof.
   *
   * Split out so a retry from the QR view pays the invoice already on screen
   * rather than asking the provider for a second one — two invoices for one
   * intended zap is how a user ends up paying twice.
   */
  const payAndSettle = useCallback(
    async (bolt11: string, payment: ZapPayment): Promise<ZapResult> => {
      setStatus("paying");
      let preimage: string | null = null;
      try {
        const result = await Promise.race([
          payInvoice(bolt11),
          sleep(PAY_TIMEOUT_MS).then(() => {
            throw new Error("TIMEOUT");
          }),
        ]);
        preimage = result?.preimage ?? null;
        if (!preimage && isPrivate) {
          const recovery = await recover(bolt11);
          preimage = recovery.state === "settled" ? recovery.preimage : null;
        }
      } catch (error) {
        // Ask the ledger before believing the error: a lost ack and an
        // error-shaped reply both happen for payments that settle anyway.
        const recovery = await recover(bolt11);
        if (recovery.state === "settled") {
          preimage = recovery.preimage;
        } else {
          setStatus("manual");
          throw error instanceof Error ? error : new Error("Payment failed.");
        }
      }

      if (isPrivate && !preimage) {
        // The sats moved; this wallet just has not surfaced the proof yet. Keep
        // asking in the background and seal it late if it turns up — the zap row
        // simply appears once it does.
        void recover(bolt11, {
          attempts: Math.max(
            1,
            Math.floor(LATE_PREIMAGE_BUDGET_MS / LATE_PREIMAGE_DELAY_MS),
          ),
          firstDelayMs: LATE_PREIMAGE_DELAY_MS,
          delayMs: LATE_PREIMAGE_DELAY_MS,
        }).then(async (late) => {
          if (late.state !== "settled" || !late.preimage) return;
          try {
            await recordPreimage(late.preimage);
          } catch {
            // Sealing failed (channel gone, signer locked). The payment still
            // settled; there is nothing further to try here.
          }
        });
        setStatus("paid");
        return { outcome: "unproven", bolt11 };
      }

      if (isPrivate && preimage) {
        await onSettled!({ ...payment, preimage });
        pending.current = null;
      }
      setStatus("paid");
      return { outcome: "paid", bolt11 };
    },
    [isPrivate, onSettled, payInvoice, recordPreimage, recover],
  );

  /** Pay the invoice already on screen (the QR view's retry). */
  const payPending = useCallback(async (): Promise<ZapResult> => {
    const held = pending.current;
    if (!held) throw new Error("There is no invoice to pay.");
    return await payAndSettle(held.bolt11, held.payment);
  }, [payAndSettle]);

  const zap = useCallback(
    async (attempt: ZapAttempt): Promise<ZapResult> => {
      const { amountSats, withWallet } = attempt;
      if (!Number.isFinite(amountSats) || amountSats < 1) {
        throw new Error("Enter an amount in sats.");
      }
      if (!lnurlData) {
        throw new Error(
          "Couldn't reach the recipient's lightning wallet service.",
        );
      }
      const comment = attempt.comment?.trim() ?? "";
      const amountMsats = amountSats * 1000;
      // A private zap's proof comes from the wallet, and only a connected NWC
      // wallet can return it. Refused up front rather than after the sats are
      // gone — see the QR path in the dialog for the fallback.
      if (amountMsats < lnurlData.minSendable) {
        throw new Error(
          `Amount too small. Minimum: ${Math.ceil(lnurlData.minSendable / 1000)} sats`,
        );
      }
      if (lnurlData.maxSendable > 0 && amountMsats > lnurlData.maxSendable) {
        throw new Error(
          `Amount too large. Maximum: ${Math.floor(lnurlData.maxSendable / 1000)} sats`,
        );
      }

      setStatus("resolving");
      try {
        // The kind-9734 exists only for the public flow. CORD.md §2 omits it
        // deliberately: the `nostr` parameter is what makes a provider mint and
        // publish a receipt naming the recipient, the amount and the event.
        let zapRequest: string | undefined;
        if (!isPrivate) {
          validateZapSupport(lnurlData);
          const signed = await createZapRequest({
            recipientPubkey,
            amountMillisats: amountMsats,
            comment,
            ...(publicContext?.eventPointer
              ? { eventPointer: publicContext.eventPointer }
              : {}),
            ...(publicContext?.addressPointer
              ? { addressPointer: publicContext.addressPointer }
              : {}),
            ...(publicContext?.relays ? { relays: publicContext.relays } : {}),
            ...(publicContext?.customTags
              ? { customTags: publicContext.customTags }
              : {}),
            ...(lightningAddress ? { lnurl: lightningAddress } : {}),
            ...(attempt.emojiTags ? { emojiTags: attempt.emojiTags } : {}),
            ...(attempt.anonymousSigner
              ? { signer: attempt.anonymousSigner }
              : {}),
          });
          zapRequest = serializeZapRequest(signed);
        }

        // A private zap's comment lives ONLY in the sealed announcement
        // (CORD.md §5): the recipient's wallet provider must not see it.
        const allowed = lnurlData.commentAllowed ?? 0;
        const providerComment =
          !isPrivate && comment && allowed > 0 && comment.length <= allowed
            ? comment
            : undefined;

        const response = await fetchInvoiceFromCallback(
          lnurlData.callback,
          amountMsats,
          zapRequest,
          providerComment,
        );
        const bolt11 = response.pr;
        // Never pay an invoice that does not encode what was asked for.
        if (bolt11Info(bolt11).amountMsats !== amountMsats) {
          throw new Error("The wallet service returned a mismatched invoice.");
        }
        setInvoice(bolt11);
        const payment: ZapPayment = {
          amountMsats,
          bolt11,
          preimage: "",
          comment,
        };
        pending.current = { bolt11, payment };

        if (!withWallet) {
          // The provider's receipt confirms a public zap once it is paid. A
          // private one cannot be proven this way at all — the caller warns,
          // and `recordPreimage` is how it can still be recorded.
          setStatus("manual");
          return { outcome: "manual", bolt11 };
        }

        return await payAndSettle(bolt11, payment);
      } catch (error) {
        setStatus((current) => (current === "manual" ? "manual" : "idle"));
        throw error;
      }
    },
    [
      isPrivate,
      lightningAddress,
      lnurlData,
      payAndSettle,
      publicContext,
      recipientPubkey,
    ],
  );

  return { zap, payPending, status, invoice, recordPreimage, reset };
}
