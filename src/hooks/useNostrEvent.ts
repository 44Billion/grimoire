import { useEffect, useState } from "react";
import type { Observable } from "rxjs";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useEventStore, use$ } from "applesauce-react/hooks";
import {
  eventLoader,
  addressLoader,
  batchedAddressLoader,
} from "@/services/loaders";
import type { NostrEvent } from "@/types/nostr";

/**
 * Type guard to check if pointer is an EventPointer
 */
function isEventPointer(
  pointer: EventPointer | AddressPointer,
): pointer is EventPointer {
  return "id" in pointer;
}

/**
 * Type guard to check if pointer is an AddressPointer
 */
function isAddressPointer(
  pointer: EventPointer | AddressPointer,
): pointer is AddressPointer {
  return "kind" in pointer && "pubkey" in pointer;
}

/**
 * A loader subscription that reports rather than throws.
 *
 * `subscribe()` with no error handler makes an rxjs error an unhandled
 * exception — and a loader errors for ordinary reasons: every relay refusing
 * the REQ, a resolve step rejecting. Events land in the EventStore, not in
 * this callback, so there is nothing to do with a value here either way; an
 * error and a clean completion are both simply "the load has settled".
 */
function subscribeQuietly(
  loader: Observable<NostrEvent>,
  label: string,
  onSettled?: () => void,
) {
  return loader.subscribe({
    complete: () => onSettled?.(),
    error: (error) => {
      console.debug(`[${label}] load failed:`, error);
      onSettled?.();
    },
  });
}

/**
 * Whether a pointer resolved, is still resolving, or came back empty.
 *
 * `"not-found"` is not final in the sense of "give up": the store keeps being
 * watched, so an event that arrives later from an unrelated subscription flips
 * it back to `"found"`. It means only that every relay this loader was willing
 * to ask has answered, which is the difference between "still loading" and a
 * skeleton that will never fill in.
 */
export type NostrEventStatus = "loading" | "found" | "not-found";

/**
 * Fetch a Nostr event by pointer, and report whether the load has settled.
 *
 * `useNostrEvent` below returns only the event, which is `undefined` both
 * while a load is in flight and after it has exhausted every relay — so a
 * caller could only ever render a spinner, and an event no relay holds spun
 * forever. Both hooks share this one implementation rather than layering, so
 * a caller that wants the status does not pay for a second REQ: nothing in
 * the loaders deduplicates two concurrent requests for the same id.
 *
 * @param pointer - string ID, EventPointer, or AddressPointer
 * @param context - Optional context for relay hints:
 *   - string: pubkey of event author (backward compatible)
 *   - NostrEvent: full event with q/r/e/p tags (comprehensive relay selection)
 */
export function useNostrEventState(
  pointer:
    | string
    | EventPointer
    | AddressPointer
    | { kind: number; pubkey: string; identifier: string }
    | undefined,
  context?: string | NostrEvent,
): { event: NostrEvent | undefined; status: NostrEventStatus } {
  const eventStore = useEventStore();

  // Watch event store for the specific event
  const event = use$(() => {
    if (!pointer) return undefined;

    // Handle string ID
    if (typeof pointer === "string") {
      return eventStore.event(pointer);
    }

    if (isEventPointer(pointer)) {
      // For EventPointer, query by ID
      return eventStore.event(pointer.id);
    } else if (isAddressPointer(pointer)) {
      // For AddressPointer, query replaceable event
      return eventStore.replaceable(
        pointer.kind,
        pointer.pubkey,
        pointer.identifier || "",
      );
    }
    return undefined;
  }, [pointer]);

  // The pointer whose load has settled, rather than a boolean an effect would
  // have to reset — a synchronous setState in an effect body cascades renders,
  // so the reset is derived below instead of written.
  const [settledPointer, setSettledPointer] = useState<string | null>(null);

  // Trigger event loading with appropriate loader
  // Use JSON.stringify for dependency to handle object changes
  const pointerKey = pointer
    ? typeof pointer === "string"
      ? pointer
      : JSON.stringify(pointer)
    : null;

  useEffect(() => {
    if (!pointer) return;

    const loader =
      typeof pointer === "string"
        ? eventLoader({ id: pointer }, context)
        : isEventPointer(pointer)
          ? eventLoader(pointer, context)
          : isAddressPointer(pointer)
            ? addressLoader(pointer)
            : null;

    if (!loader) {
      console.warn("[useNostrEvent] Unknown pointer type:", pointer);
      return;
    }

    const subscription = subscribeQuietly(loader, "useNostrEvent", () =>
      setSettledPointer(pointerKey),
    );
    return () => subscription.unsubscribe();
  }, [pointer, pointerKey, context]);

  // A settled flag from the PREVIOUS pointer must not be read as this one's
  // answer, so the two are compared rather than reset.
  const loaderSettled =
    settledPointer !== null && settledPointer === pointerKey;

  return {
    event,
    // The store wins: a late arrival from anywhere flips this back to found.
    status: event ? "found" : loaderSettled ? "not-found" : "loading",
  };
}

/**
 * Unified hook for fetching Nostr events by pointer
 * Supports string ID, EventPointer, and AddressPointer
 * @param pointer - string ID, EventPointer, or AddressPointer
 * @param context - Optional context for relay hints:
 *   - string: pubkey of event author (backward compatible)
 *   - NostrEvent: full reply event with r/e/p tags (comprehensive relay selection)
 * @returns Event or undefined
 */
export function useNostrEvent(
  pointer:
    | string
    | EventPointer
    | AddressPointer
    | { kind: number; pubkey: string; identifier: string }
    | undefined,
  context?: string | NostrEvent,
): NostrEvent | undefined {
  return useNostrEventState(pointer, context).event;
}

/**
 * Like useNostrEvent, but loads through the batched address loader.
 *
 * Use this when one component fans out over many pointers at once: a NKBIP-01
 * publication index can list 100+ sections, and a REQ per pointer makes relays
 * rate-limit so the tail of the list never resolves. Batching collapses them
 * into one REQ per 200ms window.
 */
export function useBatchedAddressableEvent(
  pointer: AddressPointer | undefined,
): NostrEvent | undefined {
  const eventStore = useEventStore();

  const event = use$(
    () =>
      pointer
        ? eventStore.replaceable(
            pointer.kind,
            pointer.pubkey,
            pointer.identifier || "",
          )
        : undefined,
    [pointer],
  );

  useEffect(() => {
    if (!pointer) return;
    const subscription = batchedAddressLoader(pointer).subscribe();
    return () => subscription.unsubscribe();
  }, [pointer]);

  return event;
}

/**
 * Convenience hook for fetching events by ID only
 * @param eventId - Event ID to fetch
 * @param relayUrl - Optional relay URL hint
 * @returns Event or undefined
 */
export function useEventById(
  eventId: string | undefined,
  relayUrl?: string,
): NostrEvent | undefined {
  const pointer = eventId
    ? ({
        id: eventId,
        relays: relayUrl ? [relayUrl] : undefined,
      } as EventPointer)
    : undefined;

  return useNostrEvent(pointer);
}
