import type { NostrEvent } from "nostr-tools";

import { nostrRefTarget } from "./open-nostr-ref";

import { getKindInfo } from "@/constants/kinds";
import db from "@/services/db";
import eventStore from "@/services/event-store";
import { getNipText } from "@/services/nip-text";

/**
 * Context for an `ai` window, built from what grimoire already holds.
 *
 * The point of asking a model inside a Nostr explorer is that the object under
 * discussion is already resident — in the EventStore, in the kind registry, in
 * the cached NIP text. No retrieval layer, no embeddings: name the thing and
 * its own data goes in the prompt.
 */
export interface AiContext {
  /** Prepended as the system message. */
  system: string;
  /** Short label for the window title. */
  label: string;
}

export type AiTargetKind = "event" | "kind" | "nip";

export interface AiTarget {
  type: AiTargetKind;
  /** Bech32 entity, kind number, or NIP id, as typed. */
  value: string;
}

/**
 * Classify a bare `ai` argument. `nip-01`/`nip01` and a plain number are
 * unambiguous; anything bech32 is an event or a profile.
 */
export function parseAiTarget(token: string): AiTarget | undefined {
  const value = token.trim();
  if (!value) return undefined;

  const nip = /^nip-?([0-9a-z]{1,3})$/i.exec(value);
  if (nip) return { type: "nip", value: nip[1].toUpperCase().padStart(2, "0") };

  if (/^(kind-?)?\d{1,5}$/i.test(value)) {
    return { type: "kind", value: value.replace(/^kind-?/i, "") };
  }

  if (/^(nostr:)?(npub|nprofile|note|nevent|naddr)1/.test(value)) {
    return { type: "event", value };
  }

  return undefined;
}

const BASE_SYSTEM =
  "You are answering inside grimoire, a Nostr protocol explorer. " +
  "Be concrete and brief. Cite kind numbers and NIP ids where they apply. " +
  "Reference people and events as nostr: bech32 entities so they render.";

/** Build the system prompt for a target, or undefined when it resolves to nothing. */
export async function buildAiContext(
  target: AiTarget,
): Promise<AiContext | undefined> {
  switch (target.type) {
    case "event":
      return eventContext(target.value);
    case "kind":
      return kindContext(Number(target.value));
    case "nip":
      return nipContext(target.value);
    default:
      return undefined;
  }
}

async function eventContext(bech32: string): Promise<AiContext | undefined> {
  const ref = nostrRefTarget(bech32);
  if (!ref) return undefined;

  // A profile: the pubkey plus whatever metadata is cached.
  if (ref.pubkey) {
    const profile = await db.profiles.get(ref.pubkey).catch(() => undefined);
    const described = profile
      ? JSON.stringify(profile, null, 2)
      : "(no cached profile metadata)";
    return {
      label: bech32.slice(0, 12),
      system: `${BASE_SYSTEM}\n\nThe user is asking about this Nostr user.\nPubkey: ${ref.pubkey}\nProfile metadata:\n${described}`,
    };
  }

  const event = findEvent(ref.eventPointer?.id);
  if (!event) {
    return {
      label: bech32.slice(0, 12),
      system: `${BASE_SYSTEM}\n\nThe user is asking about ${bech32}, which is not in the local event store yet. Say so rather than guessing its contents.`,
    };
  }

  return {
    label: `kind ${event.kind}`,
    system: `${BASE_SYSTEM}\n\nThe user is asking about this event.\n${describeKind(event.kind)}\n\nRaw event:\n${JSON.stringify(event, null, 2)}`,
  };
}

function findEvent(id?: string): NostrEvent | undefined {
  if (!id) return undefined;
  try {
    return eventStore.getEvent(id);
  } catch {
    return undefined;
  }
}

function describeKind(kind: number): string {
  const info = getKindInfo(kind);
  return info
    ? `Kind ${kind} is "${info.name}" (${info.nip}): ${info.description}`
    : `Kind ${kind} is not in grimoire's kind registry, so it is either new, experimental, or application-specific.`;
}

async function kindContext(kind: number): Promise<AiContext | undefined> {
  if (!Number.isFinite(kind)) return undefined;
  const nipText = await nipTextForKind(kind);
  return {
    label: `kind ${kind}`,
    system: `${BASE_SYSTEM}\n\nThe user is asking about event kind ${kind}.\n${describeKind(kind)}${
      nipText ? `\n\nThe NIP that defines it:\n${nipText}` : ""
    }`,
  };
}

async function nipTextForKind(kind: number): Promise<string | undefined> {
  const info = getKindInfo(kind);
  if (!info?.nip) return undefined;
  const id = info.nip.replace(/^nip-?/i, "").toUpperCase();
  return nipText(id);
}

async function nipContext(id: string): Promise<AiContext | undefined> {
  const text = await nipText(id);
  return {
    label: `NIP-${id}`,
    system: text
      ? `${BASE_SYSTEM}\n\nThe user is asking about NIP-${id}. Its full text:\n${text}`
      : `${BASE_SYSTEM}\n\nThe user is asking about NIP-${id}, whose text could not be loaded. Say plainly that you are answering from memory rather than from the spec.`,
  };
}

/** NIP body, truncated: a whole NIP can outweigh a small context window. */
async function nipText(id: string): Promise<string | undefined> {
  const content = await getNipText(id);
  if (!content) return undefined;
  const LIMIT = 24_000;
  return content.length > LIMIT
    ? `${content.slice(0, LIMIT)}\n\n[truncated]`
    : content;
}
