import { useMemo, useState, useCallback, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
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
 * Generic hook to read and manage a NIP-51-style favorite list.
 *
 * Tag format is determined by the config's tagStrategy (defaults to "e"/"a"
 * based on isAddressableKind). Pass a custom TagStrategy for non-standard
 * tag formats like NIP-29 "group" tags.
 */
export function useFavoriteList(config: FavoriteListConfig) {
  const { pubkey, canSign } = useAccount();
  const [isUpdating, setIsUpdating] = useState(false);
  const isUpdatingRef = useRef(false);

  const strategy = resolveStrategy(config);

  // Subscribe to the user's replaceable list event
  const event = use$(
    () =>
      pubkey ? eventStore.replaceable(config.listKind, pubkey, "") : undefined,
    [pubkey, config.listKind],
  );

  // Extract pointers from matching tags (only meaningful for e/a strategies)
  const items = useMemo(() => {
    if (!event) return [];
    if (strategy.tagName === "e") return getListPointers(event, "e");
    if (strategy.tagName === "a") return getListPointers(event, "a");
    return [];
  }, [event, strategy.tagName]);

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

  const isFavorite = useCallback(
    (targetEvent: NostrEvent) => {
      const key = strategy.getItemKey(targetEvent);
      return key !== "" && itemIds.has(key);
    },
    [strategy, itemIds],
  );

  /**
   * Sign and publish a new revision of the list.
   *
   * `rewrite` receives the current tags (deep-copied) and returns the ones to
   * publish; returning `null` abandons the write without touching the list.
   */
  const publishTags = useCallback(
    async (rewrite: (currentTags: string[][]) => string[][] | null) => {
      if (!canSign || isUpdatingRef.current) return;

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
          kind: config.listKind,
          content: currentContent,
          tags: newTags,
          created_at: Math.floor(Date.now() / 1000),
        });
        await publishEvent(signed);
      } catch (err) {
        console.error(
          `[useFavoriteList] Failed to update list (kind ${config.listKind}):`,
          err,
        );
      } finally {
        isUpdatingRef.current = false;
        setIsUpdating(false);
      }
    },
    [canSign, config, event],
  );

  const toggleFavorite = useCallback(
    async (targetEvent: NostrEvent) => {
      await publishTags((currentTags) => {
        const itemKey = strategy.getItemKey(targetEvent);
        if (!itemKey) return null;

        const alreadyFavorited = currentTags.some((t) =>
          strategy.matchesKey(t, itemKey),
        );

        return alreadyFavorited
          ? currentTags.filter((t) => !strategy.matchesKey(t, itemKey))
          : [...currentTags, strategy.buildTag(targetEvent)];
      });
    },
    [publishTags, strategy],
  );

  /**
   * Remove an entry by its identity key, with no event in hand.
   *
   * `toggleFavorite` needs the target event to derive the key, which a caller
   * cannot supply for an entry that no longer resolves — a deleted item, or
   * one whose author's relays are unreachable. Without this, such an entry is
   * stuck in the list with no way to remove it from the UI.
   */
  const removeItem = useCallback(
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
    items,
    itemIds,
    isFavorite,
    toggleFavorite,
    removeItem,
    isUpdating,
    event,
  };
}
