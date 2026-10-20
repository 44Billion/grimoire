import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { normalizeRelayURL, isValidRelayURL } from "@/lib/relay-url";
import type { NostrEvent } from "@/types/nostr";

/**
 * Abstracts tag format so useListMembership works with e, a, group, p, relay
 * or future tag types. `T` is whatever identifies an item: a NostrEvent for
 * bookmarks, a pubkey string for follows, a relay URL for relay lists.
 */
export interface TagStrategy<T = NostrEvent> {
  /** The tag name used in the list event (e.g., "e", "a", "group") */
  tagName: string;
  /** Compute an identity key for the given item (used in the membership set) */
  getItemKey(item: T): string;
  /** Build a complete tag array for adding an item to the list */
  buildTag(item: T): string[];
  /** Check if a stored tag matches a given identity key */
  matchesKey(tag: string[], key: string): boolean;
  /** Extract the identity key directly from a stored tag (for building itemIds set) */
  keyFromTag(tag: string[]): string | undefined;
}

function firstSeenRelay(event: NostrEvent): string {
  const relays = getSeenRelays(event);
  return relays ? Array.from(relays)[0] || "" : "";
}

/** Strategy for "e" tags — regular (non-addressable) events. */
export const eTagStrategy: TagStrategy = {
  tagName: "e",
  getItemKey(event) {
    return event.id;
  },
  buildTag(event) {
    const relay = firstSeenRelay(event);
    return relay ? ["e", event.id, relay] : ["e", event.id];
  },
  matchesKey(tag, key) {
    return eTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    return tag[0] === "e" && tag[1] ? tag[1] : undefined;
  },
};

/** Strategy for "a" tags — addressable (parameterized replaceable) events. */
export const aTagStrategy: TagStrategy = {
  tagName: "a",
  getItemKey(event) {
    const dTag = getTagValue(event, "d") || "";
    return `${event.kind}:${event.pubkey}:${dTag}`;
  },
  buildTag(event) {
    const dTag = getTagValue(event, "d") || "";
    const coordinate = `${event.kind}:${event.pubkey}:${dTag}`;
    const relay = firstSeenRelay(event);
    return relay ? ["a", coordinate, relay] : ["a", coordinate];
  },
  matchesKey(tag, key) {
    return aTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    return tag[0] === "a" && tag[1] ? tag[1] : undefined;
  },
};

/**
 * Strategy for "group" tags — NIP-29 relay-based groups (kind 10009 lists).
 *
 * Identity is `normalizedRelayUrl'groupId` to match the pattern used by
 * useNip29GroupList and the NIP-29 adapter.
 */
export const groupTagStrategy: TagStrategy = {
  tagName: "group",
  getItemKey(event) {
    const groupId = getTagValue(event, "d") || "";
    const relay = firstSeenRelay(event);
    if (!relay) return "";
    try {
      return `${normalizeRelayURL(relay)}'${groupId}`;
    } catch {
      return "";
    }
  },
  buildTag(event) {
    const groupId = getTagValue(event, "d") || "";
    const relay = firstSeenRelay(event);
    if (!relay) {
      console.warn(
        "[useFavoriteList] Cannot build group tag: no seen relay for event",
        event.id,
      );
      return ["group", groupId];
    }
    try {
      return ["group", groupId, normalizeRelayURL(relay)];
    } catch {
      return ["group", groupId, relay];
    }
  },
  matchesKey(tag, key) {
    return groupTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    if (tag[0] !== "group" || !tag[1] || !tag[2]) return undefined;
    try {
      return `${normalizeRelayURL(tag[2])}'${tag[1]}`;
    } catch {
      return undefined;
    }
  },
};

/**
 * Strategy for "p" tags — kind 3 contact lists keyed by pubkey.
 *
 * Only `tag[1]` is compared, so petname and relay-hint columns on existing
 * entries are untouched by a toggle; the whole tag is kept or dropped intact.
 */
export const pTagStrategy: TagStrategy<string> = {
  tagName: "p",
  getItemKey(pubkey) {
    return /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : "";
  },
  buildTag(pubkey) {
    return ["p", pubkey];
  },
  matchesKey(tag, key) {
    return pTagStrategy.keyFromTag(tag) === key;
  },
  keyFromTag(tag) {
    return tag[0] === "p" && tag[1] ? tag[1] : undefined;
  },
};

function normalizedRelayKey(url: string): string | undefined {
  try {
    const normalized = normalizeRelayURL(url);
    return isValidRelayURL(normalized) ? normalized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Strategy for a relay-URL tag. Identity is the normalized URL, so
 * `wss://relay.example.com/` and `wss://relay.example.com` are one entry.
 */
function relayUrlStrategy(tagName: "relay" | "r"): TagStrategy<string> {
  const keyFromTag = (tag: string[]) =>
    tag[0] === tagName && tag[1] ? normalizedRelayKey(tag[1]) : undefined;
  return {
    tagName,
    getItemKey: (url) => normalizedRelayKey(url) ?? "",
    buildTag: (url) => [tagName, normalizedRelayKey(url) ?? url],
    matchesKey: (tag, key) => keyFromTag(tag) === key,
    keyFromTag,
  };
}

/** NIP-51 relay lists (10006, 10007, 10012, 10050): plain `relay` tags. */
export const relayTagStrategy = relayUrlStrategy("relay");

/**
 * NIP-65 relay list (10002): `r` tags with read/write markers. Membership is
 * a plain lookup, but a toggle is not enough to edit it — see
 * useRelayListMembership.
 */
export const nip65TagStrategy = relayUrlStrategy("r");
