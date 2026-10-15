import type { NostrEvent } from "@/types/nostr";
import { Zap } from "lucide-react";
import { useMemo } from "react";
import {
  getZapAmount,
  getZapEventPointer,
  getZapAddressPointer,
  getZapRequest,
  getZapRecipient,
} from "applesauce-common/helpers/zap";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { RichText } from "../RichText";
import { useLocale } from "@/hooks/useLocale";
import { getSemanticContentEvent } from "@/lib/semantic-author";

/**
 * Compact preview for Kind 9735 (Zap Receipt)
 * Layout: [amount] [recipient] [zap message] [preview]
 */
export function ZapCompactPreview({ event }: { event: NostrEvent }) {
  const { locale } = useLocale();
  const zapAmount = useMemo(() => getZapAmount(event), [event]);
  const zapRequest = useMemo(() => getZapRequest(event), [event]);
  const zapRecipient = useMemo(() => getZapRecipient(event), [event]);

  // Get zapped content pointers
  const eventPointer = useMemo(() => getZapEventPointer(event), [event]);
  const addressPointer = useMemo(() => getZapAddressPointer(event), [event]);

  // Fetch the zapped event (prefer address pointer for replaceable events).
  // The receipt is the relay context: its "p" tag is the zap recipient, i.e.
  // the zapped event's author, so their outbox routes the lookup. The address
  // branch ignores context — `addressLoader` takes none.
  const zappedByEvent = useNostrEvent(eventPointer || undefined, event);
  const zappedByAddress = useNostrEvent(addressPointer || undefined, event);
  const zappedEvent = zappedByAddress || zappedByEvent;

  // A zapped zap renders its request, which holds the comment and emoji tags.
  const zappedEventForPreview = zappedEvent
    ? getSemanticContentEvent(zappedEvent)
    : undefined;

  // Convert from msats to sats
  const amountInSats = useMemo(() => {
    if (!zapAmount) return 0;
    return Math.floor(zapAmount / 1000);
  }, [zapAmount]);

  return (
    <span className="flex items-center gap-1 text-sm truncate">
      <Zap className="size-3 fill-yellow-500 text-yellow-500 shrink-0" />
      <span className="text-yellow-500 font-medium shrink-0">
        {amountInSats.toLocaleString(locale, { notation: "compact" })}
      </span>
      {zapRecipient && <UserName pubkey={zapRecipient} />}
      {zapRequest?.content && (
        <span className="truncate line-clamp-1 flex-shrink-0">
          <RichText
            event={zapRequest}
            className="inline text-sm leading-none whitespace-normal"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
      {zappedEventForPreview && (
        <span className="text-muted-foreground truncate line-clamp-1">
          <RichText
            event={zappedEventForPreview}
            className="inline text-sm leading-none whitespace-normal"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
    </span>
  );
}
