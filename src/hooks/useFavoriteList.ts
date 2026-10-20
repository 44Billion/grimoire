import { useMemo, useState, useCallback, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { toast } from "sonner";
import {
  getEventPointerFromETag,
  getAddressPointerFromATag,
} from "applesauce-core/helpers";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";
import { settingsManager } from "@/services/settings";
import { publishEvent } from "@/services/hub";
import { useAccount } from "@/hooks/useAccount";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { eTagStrategy, aTagStrategy } from "@/lib/favorite-tag-strategies";
import { listLoaded$ } from "@/services/list-sync-state";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";
import type { TagStrategy } from "@/lib/favorite-tag-strategies";
import type { FavoriteListConfig } from "@/config/favorite-lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

export function resolveStrategy(config: FavoriteListConfig): TagStrategy {
  if (config.tagStrategy) return config.tagStrategy;
  return isAddressableKind(config.elementKind) ? aTagStrategy : eTagStrategy;
}

/** Extract pointers from tags of a given type */
export function getListPointers(
  event: NostrEvent,
  tagType: "e",
): EventPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "a",
): AddressPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "e" | "a",
): EventPointer[] | AddressPointer[];
export function getListPointers(
  event: NostrEvent,
  tagType: "e" | "a",
): (EventPointer | AddressPointer)[] {
  const pointers: (EventPointer | AddressPointer)[] = [];
  for (const tag of event.tags) {
    if (tag[0] === tagType && tag[1]) {
      if (tagType === "e") {
        const pointer = getEventPointerFromETag(tag);
        if (pointer) pointers.push(pointer);
      } else {
        const pointer = getAddressPointerFromATag(tag);
        if (pointer) pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Generic read-modify-write hook for one of the active user's replaceable
 * lists (NIP-51 style). The strategy decides what an item is and how it is
 * stored as a tag; the hook owns reading the list, membership lookup, signing
 * and publishing.
 *
 * Writes start from the event in the EventStore and copy `content` through
 * untouched (kind 3 legacy relay JSON, encrypted private entries). When no
 * event is loaded the write is refused until the list's loader has completed
 * (`loaded`), so a slow relay can never turn a toggle into a wipe.
 */
export function useListMembership<T>(
  listKind: number,
  strategy: TagStrategy<T>,
) {
  const { pubkey, canSign } = useAccount();
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);

  // Subscribe to the user's replaceable list event
  const event = use$(
    () => (pubkey ? eventStore.replaceable(listKind, pubkey, "") : undefined),
    [pubkey, listKind],
  );

  const loaded =
    use$(
      () => (pubkey ? listLoaded$(listKind, pubkey) : undefined),
      [pubkey, listKind],
    ) ?? false;

  // Quick lookup set of item identity keys
  const itemIds = useMemo(() => {
    if (!event) return new Set<string>();
    const ids = new Set<string>();
    for (const tag of event.tags) {
      if (tag[0] === strategy.tagName && tag[1]) {
        const key = strategy.keyFromTag(tag);
        if (key) ids.add(key);
      }
    }
    return ids;
  }, [event, strategy]);

  const has = useCallback(
    (item: T) => {
      const key = strategy.getItemKey(item);
      return key !== "" && itemIds.has(key);
    },
    [strategy, itemIds],
  );

  /**
   * The list may be written: it is in the store, or its loader completed and
   * found nothing (a genuinely new list).
   */
  const canWrite = canSign && (!!event || loaded);

  /**
   * Sign and publish a new revision of the list.
   *
   * `rewrite` receives the current tags (deep-copied) and returns the ones to
   * publish; returning `null` abandons the write without touching the list.
   * `relays` pins the publish targets instead of the outbox selection.
   */
  const publishTags = useCallback(
    async (
      rewrite: (currentTags: string[][]) => string[][] | null,
      options?: { relays?: string[] },
    ) => {
      if (!canWrite || isUpdatingRef.current) return;

      const account = accountManager.active;
      if (!account?.signer) return;

      isUpdatingRef.current = true;
      setIsUpdating(true);
      try {
        const currentTags = event ? event.tags.map((t) => [...t]) : [];
        const currentContent = event?.content ?? "";

        let newTags = rewrite(currentTags);
        if (!newTags) return;

        if (settingsManager.getSetting("post", "includeClientTag")) {
          newTags = newTags.filter((t) => t[0] !== "client");
          newTags.push(GRIMOIRE_CLIENT_TAG);
        }

        const signed = await account.signer.signEvent({
          kind: listKind,
          content: currentContent,
          tags: newTags,
          created_at: Math.floor(Date.now() / 1000),
        });
        await publishEvent(signed, options?.relays);
      } catch (err) {
        console.error(
          `[useListMembership] Failed to update list (kind ${listKind}):`,
          err,
        );
        toast.error(
          `Could not update list: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        isUpdatingRef.current = false;
        setIsUpdating(false);
      }
    },
    [canWrite, listKind, event],
  );

  const toggle = useCallback(
    async (item: T) => {
      await publishTags((currentTags) => {
        const itemKey = strategy.getItemKey(item);
        if (!itemKey) return null;

        const present = currentTags.some((t) =>
          strategy.matchesKey(t, itemKey),
        );

        return present
          ? currentTags.filter((t) => !strategy.matchesKey(t, itemKey))
          : [...currentTags, strategy.buildTag(item)];
      });
    },
    [publishTags, strategy],
  );

  /**
   * Remove an entry by its identity key, with no item in hand.
   *
   * `toggle` needs the item to derive the key, which a caller cannot supply
   * for an entry that no longer resolves — a deleted event, or one whose
   * author's relays are unreachable. Without this, such an entry is stuck in
   * the list with no way to remove it from the UI.
   */
  const remove = useCallback(
    async (itemKey: string) => {
      if (!itemKey) return;
      await publishTags((currentTags) => {
        if (!currentTags.some((t) => strategy.matchesKey(t, itemKey)))
          return null;
        return currentTags.filter((t) => !strategy.matchesKey(t, itemKey));
      });
    },
    [publishTags, strategy],
  );

  return {
    event,
    itemIds,
    has,
    toggle,
    remove,
    publishTags,
    isUpdating,
    canWrite,
  };
}

/**
 * Hook to read and manage a NIP-51-style favorite list of events.
 *
 * Tag format is determined by the config's tagStrategy (defaults to "e"/"a"
 * based on isAddressableKind). Pass a custom TagStrategy for non-standard
 * tag formats like NIP-29 "group" tags.
 */
export function useFavoriteList(config: FavoriteListConfig) {
  const strategy = resolveStrategy(config);
  const list = useListMembership(config.listKind, strategy);
  const { event } = list;

  // Extract pointers from matching tags (only meaningful for e/a strategies)
  const items = useMemo(() => {
    if (!event) return [];
    if (strategy.tagName === "e") return getListPointers(event, "e");
    if (strategy.tagName === "a") return getListPointers(event, "a");
    return [];
  }, [event, strategy.tagName]);

  return {
    items,
    itemIds: list.itemIds,
    isFavorite: list.has,
    toggleFavorite: list.toggle,
    removeItem: list.remove,
    isUpdating: list.isUpdating,
    /** False until the list is in the store or its loader has completed. */
    canWrite: list.canWrite,
    event,
  };
}
