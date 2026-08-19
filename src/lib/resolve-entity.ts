import { nip19 } from "nostr-tools";
import { firstValueFrom, take, timeout } from "rxjs";

import { nostrRefTarget } from "./open-nostr-ref";

import eventStore from "@/services/event-store";
import { addressLoader, eventLoader } from "@/services/loaders";

import type { NostrEvent } from "@/types/nostr";

/** How long to wait on relays before answering "could not load it". */
const RESOLVE_TIMEOUT = 6_000;

export interface ResolvedProfile {
  type: "profile";
  pubkey: string;
  npub: string;
  /** The kind 0 as signed, when it can be found. */
  event?: NostrEvent;
  /** `content` already parsed, because that is what a model wants to read. */
  metadata?: unknown;
}

export interface ResolvedEvent {
  type: "event";
  /** The bech32 to quote back, rebuilt with kind and author. */
  nevent?: string;
  naddr?: string;
  event: NostrEvent;
}

export type Resolved = ResolvedProfile | ResolvedEvent | { error: string };

/**
 * A bech32 entity as the thing it names.
 *
 * Without this a model that meets an `npub` in a tag or a reply has nothing to
 * do but repeat it: bech32 is not decodable by inspection, so a question about
 * "who is this" against a raw entity is unanswerable. Here it becomes a profile
 * or an event, from the EventStore first and relays second.
 */
export async function resolveEntity(entity: string): Promise<Resolved> {
  const trimmed = entity.trim();
  const target = nostrRefTarget(trimmed);
  if (!target) {
    return {
      error: `Not a Nostr entity: ${trimmed.slice(0, 24)}. Expected npub, nprofile, note, nevent or naddr.`,
    };
  }

  if (target.pubkey) {
    const event =
      eventStore.getReplaceable(0, target.pubkey) ??
      (await load(
        addressLoader({ kind: 0, pubkey: target.pubkey, identifier: "" }),
      ));
    return {
      type: "profile",
      pubkey: target.pubkey,
      npub: nip19.npubEncode(target.pubkey),
      ...(event ? { event, metadata: parseContent(event.content) } : {}),
    };
  }

  const pointer = target.eventPointer ?? target.addressPointer;
  if (!pointer)
    return { error: `Nothing to resolve in ${trimmed.slice(0, 24)}.` };

  const cached = (() => {
    try {
      return eventStore.getEvent(pointer);
    } catch {
      return undefined;
    }
  })();
  const event =
    cached ??
    (await load(
      target.eventPointer
        ? eventLoader(target.eventPointer)
        : addressLoader(target.addressPointer!),
    ));

  if (!event) {
    return {
      error:
        "That event is not in the local store and no relay returned it. Say so rather than inventing its contents.",
    };
  }

  return {
    type: "event",
    // Rebuilt rather than echoed: kind and author make the reference dispatch
    // correctly wherever it is rendered.
    ...(target.addressPointer
      ? {
          naddr: nip19.naddrEncode({
            kind: event.kind,
            pubkey: event.pubkey,
            identifier: target.addressPointer.identifier,
          }),
        }
      : {
          nevent: nip19.neventEncode({
            id: event.id,
            kind: event.kind,
            author: event.pubkey,
          }),
        }),
    event,
  };
}

async function load(
  loader: Parameters<typeof firstValueFrom>[0],
): Promise<NostrEvent | undefined> {
  try {
    const event = await firstValueFrom(
      loader.pipe(timeout(RESOLVE_TIMEOUT), take(1)),
    );
    return (event as NostrEvent) ?? undefined;
  } catch {
    return undefined;
  }
}

function parseContent(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
