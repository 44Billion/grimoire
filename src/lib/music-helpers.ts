import type { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue, getTagValue } from "applesauce-core/helpers";
import { getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import type { AddressPointer } from "nostr-tools/nip19";

// Simple tag-based helpers (no caching needed for getTagValue)

export function getTrackTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}

export function getTrackUrl(event: NostrEvent): string | undefined {
  return getTagValue(event, "url");
}

export function getTrackArtist(event: NostrEvent): string | undefined {
  return getTagValue(event, "artist");
}

export function getTrackImage(event: NostrEvent): string | undefined {
  return getTagValue(event, "image");
}

// Cached aggregate metadata

const TrackMetadataSymbol = Symbol("trackMetadata");

export interface TrackMetadata {
  album?: string;
  trackNumber?: string;
  released?: string;
  language?: string;
  aiGenerated: boolean;
  license?: string;
}

export function getTrackMetadata(event: NostrEvent): TrackMetadata {
  return getOrComputeCachedValue(event, TrackMetadataSymbol, () => {
    return {
      album: getTagValue(event, "album"),
      trackNumber: getTagValue(event, "track_number"),
      released: getTagValue(event, "released"),
      language: getTagValue(event, "language"),
      aiGenerated: getTagValue(event, "ai_generated") === "true",
      license: getTagValue(event, "license"),
    };
  });
}

// Playlist helpers

export function getPlaylistTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}

const PlaylistTrackPointersSymbol = Symbol("playlistTrackPointers");

export function getPlaylistTrackPointers(event: NostrEvent): AddressPointer[] {
  return getOrComputeCachedValue(event, PlaylistTrackPointersSymbol, () => {
    return event.tags
      .filter((t) => t[0] === "a" && t[1])
      .map((t) => getAddressPointerFromATag(t))
      .filter((p): p is AddressPointer => p !== null && p !== undefined);
  });
}

export function isPlaylistPublic(event: NostrEvent): boolean {
  return getTagValue(event, "public") === "true";
}

export function isPlaylistCollaborative(event: NostrEvent): boolean {
  return getTagValue(event, "collaborative") === "true";
}
