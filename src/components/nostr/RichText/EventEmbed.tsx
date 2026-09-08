import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { QuotedEvent } from "../QuotedEvent";
import { useRichTextEvent } from "../RichText";

interface EventEmbedNodeProps {
  node: {
    pointer: EventPointer | AddressPointer;
  };
  depth?: number;
}

/**
 * EventEmbed component for rendering quoted/embedded Nostr events
 * Uses QuotedEvent with depth tracking for smart expand/collapse behavior
 * Passes full pointer (including relay hints) for proper event resolution
 *
 * The event the mention appears in is passed along as relay context: a mention
 * frequently carries no inline hint at all — a bare `note1`, or an `nevent`
 * written without relays — while the containing event lists where to look in
 * its "q", "r", "e" and "a" tags. Without this the only relays tried are the
 * pointer's own hints and the fallback set. `null` when RichText was handed
 * bare `content` rather than an event.
 */
export function EventEmbed({ node, depth = 1 }: EventEmbedNodeProps) {
  const { pointer } = node;
  const source = useRichTextEvent();

  // Check if it's an EventPointer (has 'id') or AddressPointer (has 'kind' + 'pubkey')
  const isEvent = "id" in pointer;

  return (
    <QuotedEvent
      eventPointer={isEvent ? pointer : undefined}
      addressPointer={!isEvent ? (pointer as AddressPointer) : undefined}
      depth={depth}
      context={source ?? undefined}
    />
  );
}
