import { useMemo } from "react";
import { nip19 } from "nostr-tools";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { useNostrEventState } from "@/hooks/useNostrEvent";
import {
  getSnoObject,
  getSnoPaletteField,
  isPaletteReference,
  parseSnoContent,
  type SnoResult,
} from "@/lib/sno-parser";
import type { NostrEvent } from "@/types/nostr";

function palettePointer(
  field: unknown,
): EventPointer | AddressPointer | undefined {
  if (typeof field !== "string" || !isPaletteReference(field)) return undefined;
  try {
    const decoded = nip19.decode(field);
    if (decoded.type === "nevent") return decoded.data;
    if (decoded.type === "naddr") return decoded.data;
  } catch {
    // A malformed reference is the built-in (§1.3b), never a rejection.
  }
  return undefined;
}

/**
 * The validated object an event carries, with its palette resolved when the
 * `palette` field names another event (DECK-0003 §1.3b). Renders with the
 * built-in at once and re-parses when the palette event arrives; a fetch that
 * fails or returns something that is not a palette keeps the built-in.
 */
export function useSnoObject(event: NostrEvent): SnoResult {
  const pointer = useMemo(
    () => palettePointer(getSnoPaletteField(event)),
    [event],
  );
  const { event: paletteEvent } = useNostrEventState(pointer, event);

  return useMemo(
    () =>
      paletteEvent
        ? parseSnoContent(event.content, paletteEvent)
        : getSnoObject(event),
    [event, paletteEvent],
  );
}
