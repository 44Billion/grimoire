/**
 * NIP-29 pinned events (`kind:9010` / `kind:39005`) — the wire, and nothing
 * that performs I/O.
 *
 * `kind:9010` (`update-pin-list`) carries the FULL ordered list as `e`
 * (regular events) and `a` (addressable events) tags — pinning, unpinning,
 * reordering and clearing are all the same operation: submit a new list.
 * Whenever the relay accepts one it regenerates `kind:39005` to mirror it,
 * with the group id in a `d` tag instead of the moderation event's `h`.
 *
 * Unlike Concord's pins (CORD-04 §7), nothing here is sealed — kind 9
 * messages are public, so a pin is a plain reference and verifying it is
 * just resolving what it points at.
 */

import type { NostrEvent } from "@/types/nostr";

export const KIND_UPDATE_PIN_LIST = 9010;
export const KIND_GROUP_PIN_LIST = 39005;

/** One entry of a pin list, in the order it should be displayed. */
export type PinEntry =
  { type: "e"; id: string } | { type: "a"; address: string };

/** An `a` tag's value, split into what it addresses. */
export interface PinAddress {
  kind: number;
  pubkey: string;
  identifier: string;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;

/** A stable key for de-duplicating and matching entries. */
export function pinEntryKey(entry: PinEntry): string {
  return entry.type === "e" ? `e:${entry.id}` : `a:${entry.address}`;
}

/**
 * The ordered entries of a pin list, from either its `kind:9010` update or
 * its `kind:39005` mirror — both carry the same `e`/`a` tags. Malformed
 * tags and repeats of an already-seen entry are dropped rather than kept as
 * "probably fine": the first occurrence is a curator's choice, and a relay
 * or a stray republish adding a second one names nothing new.
 */
export function parsePinListEntries(tags: string[][]): PinEntry[] {
  const seen = new Set<string>();
  const entries: PinEntry[] = [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || typeof tag[1] !== "string" || !tag[1]) {
      continue;
    }
    let entry: PinEntry | undefined;
    if (tag[0] === "e") entry = { type: "e", id: tag[1] };
    else if (tag[0] === "a") entry = { type: "a", address: tag[1] };
    if (!entry) continue;
    const key = pinEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

/**
 * Split an `a` tag's value into the addressable event it names.
 *
 * The identifier is everything after the second colon, joined back together
 * — NIP-01 does not forbid one containing a colon of its own, and splitting
 * on every colon would truncate it.
 */
export function parsePinAddress(address: string): PinAddress | undefined {
  const parts = address.split(":");
  if (parts.length < 3) return undefined;
  const kind = Number(parts[0]);
  const pubkey = parts[1];
  const identifier = parts.slice(2).join(":");
  if (!Number.isInteger(kind) || kind < 0) return undefined;
  if (!HEX64_RE.test(pubkey)) return undefined;
  return { kind, pubkey, identifier };
}

/** The tags a `kind:9010` needs: the group's `h` tag, then the list in order. */
export function buildUpdatePinListTags(
  groupId: string,
  entries: readonly PinEntry[],
): string[][] {
  return [
    ["h", groupId],
    ...entries.map((entry): string[] =>
      entry.type === "e" ? ["e", entry.id] : ["a", entry.address],
    ),
  ];
}

/** `entries` with `entry` appended, unless it is already pinned. */
export function withPinAdded(
  entries: readonly PinEntry[],
  entry: PinEntry,
): PinEntry[] {
  const key = pinEntryKey(entry);
  if (entries.some((e) => pinEntryKey(e) === key)) return [...entries];
  return [...entries, entry];
}

/** `entries` with any entry matching `entry` removed. */
export function withPinRemoved(
  entries: readonly PinEntry[],
  entry: PinEntry,
): PinEntry[] {
  const key = pinEntryKey(entry);
  return entries.filter((e) => pinEntryKey(e) !== key);
}

/** Whether `id` is pinned by a regular `e` entry in `entries`. */
export function isEventPinned(
  entries: readonly PinEntry[],
  id: string,
): boolean {
  return entries.some((e) => e.type === "e" && e.id === id);
}

/**
 * Adapt a resolved Nostr event into the shape Concord's `PinsHeaderButton`
 * and `ConcordPinsList` already render (`VerifiedPin`, `@/lib/concord/pins`).
 *
 * Those components only ever consume that shape — never Concord's sealed-pin
 * verification — so a NIP-29 pin, which has nothing to verify beyond "the
 * relay published it", costs nothing to render with the same UI rather than
 * growing a second one.
 */
export function eventToPinFields(event: NostrEvent): {
  rumorId: string;
  authorHex: string;
  kind: number;
  content: string;
  createdAt: number;
  tags: string[][];
} {
  return {
    rumorId: event.id,
    authorHex: event.pubkey,
    kind: event.kind,
    content: event.content,
    createdAt: event.created_at,
    tags: event.tags,
  };
}
