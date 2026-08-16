import type { AddressPointer } from "nostr-tools/nip19";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { isValidHexPubkey, isValidHexEventId } from "@/lib/nostr-validation";
import { isValidRelayURL } from "@/lib/relay-url";
import { getTagValues } from "@/lib/nostr-utils";
import type { NostrEvent } from "@/types/nostr";

/**
 * NKBIP-01 curated publication helpers — kind 30040 (index) and 30041 (section).
 *
 * A 30040 has empty content: the publication lives entirely in its tags, with
 * ordered `a` tags acting as the table of contents.
 *
 * Cached helpers use getOrComputeCachedValue, so components need no useMemo and
 * the returned objects stay referentially stable across renders.
 */

export const PUBLICATION_INDEX_KIND = 30040;
export const PUBLICATION_SECTION_KIND = 30041;

/** Kinds NKBIP-01 allows as leaves of an index */
export const PUBLICATION_LEAF_KINDS = [
  30041, 30040, 30023, 30817, 30818,
] as const;

const PUBLICATION_TYPES = [
  "book",
  "illustrated",
  "magazine",
  "documentation",
  "academic",
  "blog",
] as const;

export type PublicationType = (typeof PUBLICATION_TYPES)[number];

export interface PublicationEntry {
  /** "kind:pubkey:dtag" exactly as written — the cycle-guard key */
  coordinate: string;
  pointer: AddressPointer;
  /** a-tag 4th element: a pinned version. Recorded for display, not fetched. */
  pinnedEventId?: string;
  /** a-tag 3rd element, when it is a usable relay URL */
  relayHint?: string;
}

export interface PublicationAuthor {
  name: string;
  role?: string;
}

export interface PublicationOrigin {
  /** "p" tag — the original author */
  pubkey?: string;
  /** "E" tag — ["E", <event id>, <relay>, <pubkey>] */
  event?: { id: string; relay?: string; pubkey?: string };
}

export interface PublicationDerivative {
  /** One entry per work this publication derives from */
  origins: PublicationOrigin[];
}

export interface PublicationMeta {
  version?: string;
  publishedOn?: string;
  publishedBy?: string;
  image?: string;
  summary?: string;
  /** "s" tag (formerly "source") — URL of the original text */
  source?: string;
}

// Cache symbols
const AuthorsSymbol = Symbol("publicationAuthors");
const EntriesSymbol = Symbol("publicationEntries");
const MetaSymbol = Symbol("publicationMeta");
const DerivativeSymbol = Symbol("publicationDerivative");

export function getPublicationTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}

/** "T" — the title tag normalized like a d-tag */
export function getPublicationNormalizedTitle(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "T");
}

/** "N" — author names normalized like d-tags */
export function getPublicationNormalizedAuthors(event: NostrEvent): string[] {
  return getTagValues(event, "N");
}

export function getPublicationHashtags(event: NostrEvent): string[] {
  return getTagValues(event, "t");
}

/** "i" — external identifiers (isbn, openlibrary, wikidata, …) */
export function getPublicationExternalIds(event: NostrEvent): string[] {
  return getTagValues(event, "i");
}

export function getPublicationType(event: NostrEvent): PublicationType {
  const value = getTagValue(event, "type")?.toLowerCase();
  return PUBLICATION_TYPES.find((t) => t === value) ?? "book";
}

export function isPublicationLeafKind(kind: number): boolean {
  return (PUBLICATION_LEAF_KINDS as readonly number[]).includes(kind);
}

/**
 * Authors from repeatable `author` tags.
 *
 * The spec's prose says the role is the "3rd element" while its example uses
 * ["author", "James Black", "translator"], so accept both placements.
 */
export function getPublicationAuthors(event: NostrEvent): PublicationAuthor[] {
  return getOrComputeCachedValue(event, AuthorsSymbol, () => {
    const authors: PublicationAuthor[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "author" || !tag[1]) continue;
      const role = tag[3]?.trim() || tag[2]?.trim() || undefined;
      authors.push({ name: tag[1].trim(), ...(role ? { role } : {}) });
    }
    return authors;
  });
}

/**
 * The table of contents, in `a`-tag order.
 *
 * getAddressPointers() cannot be reused here: nostr-tools' AddressPointer has
 * no field for the a-tag's 4th element, so the pinned version would be lost.
 *
 * Each pointer also carries the relays the index itself was seen on. Published
 * `a`-tag hints go stale — GitCitadel's publications hint at a relay that
 * answers EOSE with nothing — and a loader that trusts a hint which replies
 * "no such event" leaves the row loading forever. Sections almost always live
 * wherever their index does, so that is the stronger hint.
 */
export function getPublicationEntries(event: NostrEvent): PublicationEntry[] {
  return getOrComputeCachedValue(event, EntriesSymbol, () => {
    const indexRelays = [...(getSeenRelays(event) ?? [])];
    const entries: PublicationEntry[] = [];
    for (const tag of event.tags) {
      if (tag[0] !== "a" || !tag[1]) continue;

      const [kindStr, pubkey, ...rest] = tag[1].split(":");
      const kind = Number(kindStr);
      // d-tags may contain colons, so rejoin everything after the pubkey
      const identifier = rest.join(":");
      if (!Number.isFinite(kind) || !pubkey || !isValidHexPubkey(pubkey))
        continue;

      const relayHint = isValidRelayURL(tag[2]) ? tag[2] : undefined;
      const pinnedEventId =
        tag[3] && isValidHexEventId(tag[3]) ? tag[3] : undefined;
      const relays = [...new Set([relayHint, ...indexRelays])].filter(
        (url): url is string => !!url,
      );

      entries.push({
        coordinate: tag[1],
        pointer: {
          kind,
          pubkey,
          identifier,
          ...(relays.length > 0 ? { relays } : {}),
        },
        ...(relayHint ? { relayHint } : {}),
        ...(pinnedEventId ? { pinnedEventId } : {}),
      });
    }
    return entries;
  });
}

export function getPublicationMeta(event: NostrEvent): PublicationMeta {
  return getOrComputeCachedValue(event, MetaSymbol, () => ({
    version: getTagValue(event, "version"),
    publishedOn: getTagValue(event, "published_on"),
    publishedBy: getTagValue(event, "published_by"),
    image: getTagValue(event, "image"),
    summary: getTagValue(event, "summary"),
    source: getTagValue(event, "s") || getTagValue(event, "source"),
  }));
}

/**
 * Derivative works carry a `p` tag for the original author and an `E` tag
 * referencing the original event "immediately after the `p` tag" — so a
 * publication derived from several works pairs them by adjacency rather than
 * emitting one flat list of each. An `E` with no preceding `p` still counts.
 */
export function getPublicationDerivative(
  event: NostrEvent,
): PublicationDerivative | null {
  return getOrComputeCachedValue(event, DerivativeSymbol, () => {
    const origins: PublicationOrigin[] = [];

    for (const tag of event.tags) {
      if (tag[0] === "p" && isValidHexPubkey(tag[1])) {
        origins.push({ pubkey: tag[1] });
        continue;
      }
      if (tag[0] !== "E" || !isValidHexEventId(tag[1])) continue;

      const originalEvent = {
        id: tag[1],
        ...(isValidRelayURL(tag[2]) ? { relay: tag[2] } : {}),
        ...(tag[3] && isValidHexPubkey(tag[3]) ? { pubkey: tag[3] } : {}),
      };

      const previous = origins[origins.length - 1];
      if (previous && !previous.event) previous.event = originalEvent;
      else origins.push({ event: originalEvent });
    }

    return origins.length > 0 ? { origins } : null;
  });
}

/**
 * NIP-54 style normalization, as NKBIP-01 uses for its `T` and `N` tags and as
 * wiki links resolve against: lowercase, runs of non-alphanumerics become a
 * single hyphen, leading and trailing hyphens trimmed.
 */
export function normalizeWikiTarget(target: string): string {
  return target
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
