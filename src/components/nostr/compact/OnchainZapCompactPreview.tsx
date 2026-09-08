import { useMemo } from "react";

import type { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { RichText } from "../RichText";
import { OnchainZapAmount } from "../kinds/OnchainZapRenderer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { parseOnchainZap, type OnchainZapClaim } from "@/lib/onchain-zap";
import { parseAddressPointer } from "@/lib/nip89-helpers";

/**
 * Compact preview for kind 8333 (on-chain zap).
 *
 * Layout mirrors {@link ZapCompactPreview}: [amount] [recipient] [comment]
 * [what was zapped]. The amount comes from `OnchainZapAmount`, which is the
 * only component allowed to draw one — so a row here can never print the
 * sender's unverified claim, even by accident.
 */
export function OnchainZapCompactPreview({ event }: { event: NostrEvent }) {
  const claim = useMemo(() => parseOnchainZap(event), [event]);
  if (!claim) return null;
  return <OnchainZapRow claim={claim} event={event} />;
}

function OnchainZapRow({
  claim,
  event,
}: {
  claim: OnchainZapClaim;
  event: NostrEvent;
}) {
  const pointers = useMemo(
    () => ({
      address: claim.targetAddress
        ? parseAddressPointer(claim.targetAddress)
        : null,
      event: claim.targetId ? { id: claim.targetId } : null,
    }),
    [claim],
  );

  // The 8333 is the relay context: its `p` tag is the recipient, i.e. the
  // zapped event's author, whose outbox routes the lookup.
  const byAddress = useNostrEvent(pointers.address ?? undefined, event);
  const byId = useNostrEvent(pointers.event ?? undefined, event);
  const zapped = byAddress ?? byId;

  return (
    <span className="flex items-center gap-1 text-sm truncate">
      <OnchainZapAmount claim={claim} />
      <UserName pubkey={claim.recipientPubkeys[0]} />
      {claim.recipientPubkeys.length > 1 && (
        <span className="text-xs text-muted-foreground shrink-0">
          +{claim.recipientPubkeys.length - 1}
        </span>
      )}
      {claim.comment && (
        <span className="truncate line-clamp-1 flex-shrink-0">
          <RichText
            event={event}
            className="inline text-sm leading-none whitespace-normal"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
      {zapped && (
        <span className="text-muted-foreground truncate line-clamp-1">
          <RichText
            event={zapped}
            className="inline text-sm leading-none whitespace-normal"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
    </span>
  );
}
