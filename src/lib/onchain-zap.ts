/**
 * Kind 8333 — on-chain zaps (Ditto's `NIP.md`).
 *
 * The on-chain analogue of a NIP-57 zap receipt, with one structural
 * difference that decides the whole design: a 9735 receipt is signed by the
 * recipient's LNURL provider, so its amount is attested; an 8333 is signed by
 * the SENDER, so its `amount` tag is a claim and, in the spec's words,
 * "trivially spoofable". Displaying it before checking the chain would be a
 * spec violation and a way to fake a large zap for free.
 *
 * Verification needs a network round-trip, and every surface that renders a
 * zap in grimoire is synchronous. So the work splits in two, and the split is
 * the load-bearing rule in this feature:
 *
 *   - THIS MODULE is pure and synchronous. It parses, gates and dedupes. Its
 *     output carries `claimedSats`, which NOTHING may render.
 *   - `useOnchainZap` + `OnchainZapAmount` are the only code allowed to turn a
 *     claim into a displayed number, and they do it only after summing the
 *     transaction's real outputs.
 *
 * `verifyAgainstOutputs` lives here rather than beside the fetch so the
 * arithmetic — which is where a mistake silently zeroes every zap — is
 * testable with plain data and no mocking.
 */

import { isValidHexEventId, isValidHexPubkey } from "@/lib/nostr-validation";
import { isTxid } from "@/lib/mempool";

export const ONCHAIN_ZAP_PREFIX = "bitcoin:tx:";

/**
 * Everything an 8333 event states about itself, once the synchronous gates
 * have passed. Deliberately NOT a verdict: no field here is displayable as an
 * amount.
 */
export interface OnchainZapClaim {
  /** The 8333 event's own id, so a row can be keyed and deduped. */
  eventId: string;
  /** Bitcoin transaction id, 64 lowercase hex. */
  txid: string;
  /** The sender — the event's signer, unlike a 9735 where it is a provider. */
  senderPubkey: string;
  /** Every `p` tag, in event order, deduped. At least one. */
  recipientPubkeys: string[];
  /**
   * The sender's own figure, in sats.
   *
   * NOT DISPLAYABLE. It exists so the verified amount can be capped against
   * it, and so a detail view can say the two disagree. Rendering it is the
   * bug this whole module is shaped to prevent.
   */
  claimedSats: number;
  /** The sender's comment. A plain string — NOT zap-request JSON, unlike 9735. */
  comment: string;
  createdAt: number;
  /** `e` — the zapped event. */
  targetId?: string;
  /** `a` — the zapped addressable event, `kind:pubkey:d`. */
  targetAddress?: string;
  /** `k` — the target's kind, when stated. */
  targetKind?: number;
}

/** The txid from an `i` tag, or null when there isn't a well-formed one. */
export function extractOnchainZapTxid(tags: string[][]): string | null {
  for (const tag of tags) {
    if (tag[0] !== "i" || typeof tag[1] !== "string") continue;
    if (!tag[1].startsWith(ONCHAIN_ZAP_PREFIX)) continue;
    const txid = tag[1].slice(ONCHAIN_ZAP_PREFIX.length);
    // The spec pins the txid to lowercase hex, and the dedupe key depends on
    // that, so this does not normalise — a mixed-case txid is malformed.
    if (isTxid(txid)) return txid;
  }
  return null;
}

/**
 * The claimed total in sats, or null when absent or unusable.
 *
 * Strict on purpose: `parseInt` would read "1.5" as 1 and "1e3" as 1, turning
 * a malformed tag into a plausible-looking number.
 */
export function extractOnchainZapClaimedAmount(
  tags: string[][],
): number | null {
  for (const tag of tags) {
    if (tag[0] !== "amount" || typeof tag[1] !== "string") continue;
    if (!/^\d+$/.test(tag[1])) return null;
    const sats = Number(tag[1]);
    if (!Number.isSafeInteger(sats) || sats <= 0) return null;
    return sats;
  }
  return null;
}

/** Every valid `p` tag, in event order, deduped and lowercased. */
export function extractOnchainZapRecipients(tags: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== "p" || typeof tag[1] !== "string") continue;
    if (!isValidHexPubkey(tag[1])) continue;
    const pk = tag[1].toLowerCase();
    if (seen.has(pk)) continue;
    seen.add(pk);
    out.push(pk);
  }
  return out;
}

/**
 * The fields an 8333 is read from — structural rather than `NostrEvent`, so a
 * Concord rumor can be parsed by the same gates without being dressed up as a
 * signed event first.
 */
export interface OnchainZapSource {
  id: string;
  pubkey: string;
  tags: string[][];
  content: string;
  created_at: number;
}

/**
 * Every synchronous gate in one place. `null` means this is not a well-formed
 * on-chain zap, and a malformed zap is not a weaker zap — it gets no row at
 * all, the same stance `verifyZapRumor` takes on a bad Lightning proof.
 */
export function parseOnchainZap(
  event: OnchainZapSource,
): OnchainZapClaim | null {
  const txid = extractOnchainZapTxid(event.tags);
  if (!txid) return null;

  const recipientPubkeys = extractOnchainZapRecipients(event.tags);
  if (recipientPubkeys.length === 0) return null;

  const claimedSats = extractOnchainZapClaimedAmount(event.tags);
  if (claimedSats === null) return null;

  // Self-zaps are rejected wherever the sender appears, not just in the first
  // `p` tag: they cost nothing to fabricate, since the sender already controls
  // the destination key, and they say nothing about anyone's regard for
  // anything.
  const sender = event.pubkey.toLowerCase();
  if (recipientPubkeys.includes(sender)) return null;

  const find = (name: string) =>
    event.tags.find((t) => t[0] === name && typeof t[1] === "string")?.[1];

  const targetId = find("e");
  const targetAddress = find("a");
  const kTag = find("k");
  const targetKind = kTag && /^\d+$/.test(kTag) ? Number(kTag) : undefined;

  return {
    eventId: event.id,
    txid,
    senderPubkey: sender,
    recipientPubkeys,
    claimedSats,
    comment: event.content ?? "",
    createdAt: event.created_at,
    ...(targetId && isValidHexEventId(targetId) ? { targetId } : {}),
    ...(targetAddress ? { targetAddress } : {}),
    ...(targetKind !== undefined ? { targetKind } : {}),
  };
}

/**
 * One zap per (txid, target, recipient set), earliest `created_at` winning.
 *
 * Anyone can publish an 8333 pointing at someone else's real transaction, so
 * without this a single payment can be replayed into a hundred rows. Earliest
 * wins because that is the spec's tiebreak, and because the first to claim a
 * transaction is the one most likely to have made it.
 *
 * THE RECIPIENT SET IS PART OF THE KEY, which the spec's own "one event per
 * (txid, target)" wording does not require — and it has to be, because that is
 * not how batch zaps actually appear on relays. The spec's multi-recipient
 * form is one event with many `p` tags, but Amethyst publishes a batch as one
 * event PER RECIPIENT, all sharing the transaction and the zapped event:
 * a76003c5…e192 is a real 13-output transaction announced as seven separate
 * events. Keyed on (txid, target) alone, six real recipients' zaps vanish as
 * replays.
 *
 * Nothing is given up by widening it. A true replay copies the tags, so it
 * still collides and still loses. An attacker who edits the `p` tag to name
 * themselves gets past this pass and then fails verification, because the
 * transaction paid no output to their derived address — the chain, not the
 * dedupe, is what makes that attack pointless.
 *
 * Order-independent: the result does not depend on the input order.
 */
export function dedupeOnchainZaps(
  claims: OnchainZapClaim[],
): OnchainZapClaim[] {
  const best = new Map<string, OnchainZapClaim>();
  for (const claim of claims) {
    const key = [
      claim.txid,
      claim.targetAddress ?? claim.targetId ?? "",
      // Sorted: two relays can hand over the same event's tags in any order.
      [...claim.recipientPubkeys].sort().join(","),
    ].join("|");
    const held = best.get(key);
    if (
      !held ||
      claim.createdAt < held.createdAt ||
      // Same second: fall back to the event id so two relays feeding the same
      // pair in different orders still agree on which row survives.
      (claim.createdAt === held.createdAt && claim.eventId < held.eventId)
    ) {
      best.set(key, claim);
    }
  }
  return Array.from(best.values());
}

/**
 * The same gates, for a Chat Plane rumor (`OpenedEvent`) rather than a signed
 * event. A rumor has no signature of its own — the seal's signer is the
 * verified author — so `rumorId` and `author` stand in for `id` and `pubkey`.
 */
export function parseOnchainZapRumor(rumor: {
  rumorId: string;
  author: string;
  kind: number;
  tags: string[][];
  content: string;
  createdAt: number;
}): OnchainZapClaim | null {
  return parseOnchainZap({
    id: rumor.rumorId,
    pubkey: rumor.author,
    tags: rumor.tags,
    content: rumor.content,
    created_at: rumor.createdAt,
  });
}

/** One transaction output, as much of it as verification needs. */
export interface OnchainZapOutput {
  /** Absent for an output with no address form, e.g. OP_RETURN. */
  address?: string;
  /** Value in sats. */
  value: number;
}

/**
 * The verified amount: the sum of outputs paying any listed recipient's
 * derived Taproot address.
 *
 * `senderAddress` is the sender's own derived address, and its outputs are
 * change — spending your own coins back to yourself is not a payment to
 * anyone. Excluding it cannot swallow a real payment: if a recipient's
 * derived address equalled the sender's, they would be the same key, and
 * `parseOnchainZap`'s self-zap gate already dropped the event.
 *
 * Returns 0 when nothing reached a recipient, which the caller must read as
 * "discard this event" rather than "a zap of zero".
 */
export function verifyAgainstOutputs(
  outputs: OnchainZapOutput[],
  recipientAddresses: Iterable<string>,
  senderAddress: string | null,
): number {
  const recipients = new Set(recipientAddresses);
  if (recipients.size === 0) return 0;

  let total = 0;
  for (const output of outputs) {
    if (!output.address) continue;
    if (senderAddress && output.address === senderAddress) continue;
    if (!recipients.has(output.address)) continue;
    if (!Number.isFinite(output.value) || output.value <= 0) continue;
    total += output.value;
  }
  return total;
}
