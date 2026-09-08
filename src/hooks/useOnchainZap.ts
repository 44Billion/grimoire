/**
 * Verify a kind-8333 on-chain zap and report what may be displayed.
 *
 * This is the only impure half of the feature, and the only code allowed to
 * turn a sender's claim into a number on screen. `parseOnchainZap` established
 * that the event is well-formed; this establishes that the money moved.
 *
 * No `setState` anywhere: the verdict comes from Dexie through `useLiveQuery`,
 * which re-runs when the transaction lands, and the "we could not reach the
 * explorer" case comes from `useSyncExternalStore` over the attempt store —
 * the one outcome that writes nothing for Dexie to observe.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import db from "@/services/db";
import {
  deriveTaprootAddress,
  deriveTaprootAddresses,
} from "@/lib/taproot-address";
import { verifyAgainstOutputs, type OnchainZapClaim } from "@/lib/onchain-zap";
import {
  ensureOnchainTx,
  getAttemptState,
  subscribeAttempts,
} from "@/services/onchain-tx";

export type OnchainZapStatus =
  /** The lookup is in flight. Show no amount — not even the claim. */
  | "verifying"
  /** The chain agrees. `amountSats` is safe to display. */
  | "verified"
  /**
   * The chain disagrees: no such transaction, or nothing in it reached a
   * listed recipient. The spec says discard, so the row should not render.
   */
  | "rejected"
  /**
   * The explorer could not be reached. NOT a verdict — an outage must not be
   * allowed to look like an accusation, so this shows a label and no number.
   */
  | "unavailable";

export interface OnchainZapResult {
  status: OnchainZapStatus;
  /** Verified and capped. Present only when `status === "verified"`. */
  amountSats?: number;
  /** False while the transaction is still in the mempool. */
  confirmed: boolean;
  /** True when the sender claimed more than the transaction actually paid. */
  overclaimed: boolean;
  txid: string;
}

const VERIFYING = (txid: string): OnchainZapResult => ({
  status: "verifying",
  confirmed: false,
  overclaimed: false,
  txid,
});

export function useOnchainZap(
  claim: OnchainZapClaim | null | undefined,
): OnchainZapResult {
  const txid = claim?.txid;

  // Kick the lookup off. The service dedupes in flight and skips a cached
  // confirmed transaction, so calling it on every commit is free.
  useEffect(() => {
    if (txid) ensureOnchainTx(txid);
  }, [txid]);

  const attemptSnapshot = useCallback(
    () => (txid ? getAttemptState(txid) : "idle"),
    [txid],
  );
  const attempt = useSyncExternalStore(
    subscribeAttempts,
    attemptSnapshot,
    attemptSnapshot,
  );

  // The recipient list is part of the verdict, not of the transaction, so it
  // belongs in the dependencies rather than in the cache key.
  const recipientsKey = claim?.recipientPubkeys.join(",");

  const verdict = useLiveQuery(async () => {
    if (!claim) return undefined;

    const row = await db.onchainTxCache.get(claim.txid);
    if (!row) return undefined;

    if (row.missing === 1) {
      return {
        status: "rejected",
        confirmed: false,
        overclaimed: false,
        txid: claim.txid,
      } satisfies OnchainZapResult;
    }

    const recipients = await deriveTaprootAddresses(claim.recipientPubkeys);
    const senderAddress = await deriveTaprootAddress(claim.senderPubkey);
    const verified = verifyAgainstOutputs(
      row.outputs,
      recipients.values(),
      senderAddress,
    );

    if (verified === 0) {
      return {
        status: "rejected",
        confirmed: row.confirmed === 1,
        overclaimed: false,
        txid: claim.txid,
      } satisfies OnchainZapResult;
    }

    return {
      status: "verified",
      // Capped at what the chain shows. The claim is never the larger of the
      // two on screen; the spec forbids displaying it when it exceeds.
      amountSats: Math.min(claim.claimedSats, verified),
      confirmed: row.confirmed === 1,
      overclaimed: claim.claimedSats > verified,
      txid: claim.txid,
    } satisfies OnchainZapResult;
  }, [claim?.txid, claim?.senderPubkey, claim?.claimedSats, recipientsKey]);

  if (!txid) return VERIFYING("");
  if (verdict) return verdict;
  // No row yet. A failed attempt is the only reason that is not "still going".
  if (attempt === "failed") {
    return {
      status: "unavailable",
      confirmed: false,
      overclaimed: false,
      txid,
    };
  }
  return VERIFYING(txid);
}
