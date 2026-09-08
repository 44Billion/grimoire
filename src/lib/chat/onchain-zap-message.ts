/**
 * Turning a kind-8333 event into a chat row.
 *
 * Shared by the NIP-10, NIP-22 and NIP-53 adapters, which handle Lightning
 * zaps identically three times over; there is no reason to write the on-chain
 * case three times too, and one copy is one place for the rule below to hold.
 *
 * THE RULE: this never sets `zapAmount`. `ChatViewer` prints that field
 * straight out, and an 8333's amount is the sender's own unverified claim, so
 * putting it there would display a spoofable number — while putting 0 there
 * would display a literal "0". The claim rides in `metadata.onchainZap`
 * instead, where only `OnchainZapAmount` reads it, after checking the chain.
 */

import { getEventPointerFromETag } from "applesauce-core/helpers/pointers";

import type { ChatProtocol, Message } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import { dedupeOnchainZaps, parseOnchainZap } from "@/lib/onchain-zap";
import { ONCHAIN_ZAP_KIND } from "@/constants/kinds";

/**
 * `null` when the event is not a well-formed on-chain zap — malformed, or a
 * self-zap. Both are free to fabricate, so neither gets a row.
 */
export function onchainZapToMessage(
  event: NostrEvent,
  conversationId: string,
  protocol: ChatProtocol,
): Message | null {
  const claim = parseOnchainZap(event);
  if (!claim) return null;

  // The relay hint in the `e` tag is worth keeping, so the pointer is built
  // from the tag rather than from the bare id the claim carries.
  const eTag = event.tags.find((t) => t[0] === "e");
  const replyTo = eTag
    ? (getEventPointerFromETag(eTag) ?? undefined)
    : undefined;

  return {
    id: event.id,
    conversationId,
    // The sender IS the signer here. A 9735 needs `getZapSender` because its
    // signer is the recipient's LNURL provider; an 8333 has no such detour.
    author: claim.senderPubkey,
    content: claim.comment,
    timestamp: claim.createdAt,
    type: "zap",
    replyTo,
    protocol,
    metadata: { onchainZap: claim },
    event,
  };
}

/**
 * Drop replayed on-chain zaps from a batch, keeping the canonical one per
 * (txid, target, recipient set).
 *
 * This is not tidiness, it is the defense against credit theft. An 8333 is
 * self-attested, so anyone can take someone else's event, re-sign its tags
 * under their own key and publish it. Nothing downstream catches that on its
 * own: the replayer is not in the `p` set, so the self-zap gate passes, and
 * verification SUCCEEDS, because the transaction really did pay the listed
 * recipients. The row would render the thief as the sender of a verified zap.
 * The earliest claim on a transaction wins, and that is what stops it.
 *
 * Applied to the whole batch rather than per event so the result does not
 * depend on arrival order — `dedupeOnchainZaps` is order-independent, and a
 * per-event decision could not retract a row it had already emitted.
 * Concord's fold does the same thing at the same point.
 *
 * Events that are not on-chain zaps pass through untouched, as do malformed
 * ones — `onchainZapToMessage` refuses those individually.
 */
export function dropReplayedOnchainZaps(events: NostrEvent[]): NostrEvent[] {
  const claims = [];
  for (const event of events) {
    if (event.kind !== ONCHAIN_ZAP_KIND) continue;
    const claim = parseOnchainZap(event);
    if (claim) claims.push(claim);
  }
  if (claims.length < 2) return events;

  const canonical = new Set(dedupeOnchainZaps(claims).map((c) => c.eventId));
  return events.filter(
    (event) => event.kind !== ONCHAIN_ZAP_KIND || canonical.has(event.id),
  );
}
