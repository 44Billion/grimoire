import { decodeNostr } from "./decode-parser";

import type { AppId } from "@/types/app";

/** Bech32 nostr entities, with or without a `nostr:` prefix. */
const NOSTR_REF =
  /(?:nostr:)?(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]{20,}|note1[023456789acdefghjklmnpqrstuvwxyz]{58}|nevent1[023456789acdefghjklmnpqrstuvwxyz]{20,}|naddr1[023456789acdefghjklmnpqrstuvwxyz]{20,})/g;

export interface NostrRefTarget {
  appId: AppId;
  props: Record<string, unknown>;
}

/**
 * Map a bech32 entity onto the window that shows it — the same mapping
 * `DecodeViewer` uses, extracted so any surface can open a reference.
 * Returns undefined for anything that does not decode.
 */
export function nostrRefTarget(bech32: string): NostrRefTarget | undefined {
  let decoded;
  try {
    decoded = decodeNostr(bech32.replace(/^nostr:/, ""));
  } catch {
    return undefined;
  }

  switch (decoded.type) {
    case "npub":
      return { appId: "profile", props: { pubkey: decoded.data } };
    case "nprofile":
      return {
        appId: "profile",
        props: { pubkey: decoded.data.pubkey, relays: decoded.data.relays },
      };
    case "note":
      return { appId: "open", props: { pointer: { id: decoded.data } } };
    case "nevent":
      return {
        appId: "open",
        props: {
          pointer: {
            id: decoded.data.id,
            relays: decoded.data.relays,
            kind: decoded.data.kind,
            author: decoded.data.author,
          },
        },
      };
    case "naddr":
      return {
        appId: "open",
        props: {
          pointer: {
            kind: decoded.data.kind,
            pubkey: decoded.data.pubkey,
            identifier: decoded.data.identifier,
            relays: decoded.data.relays,
          },
        },
      };
    default:
      return undefined;
  }
}

export interface NostrRefSegment {
  text: string;
  /** Present when this segment is an openable reference. */
  target?: NostrRefTarget;
}

/**
 * Split text into plain and reference segments. Callers render the segments
 * with the target as a click handler; nothing here touches the DOM.
 */
export function splitNostrRefs(text: string): NostrRefSegment[] {
  const segments: NostrRefSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(NOSTR_REF)) {
    const start = match.index;
    const target = nostrRefTarget(match[1]);
    if (!target) continue;

    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start) });
    }
    segments.push({ text: match[1], target });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments;
}
