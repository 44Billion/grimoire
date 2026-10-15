import type { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { buildSnoBuffers, partMatrix } from "@/lib/sno-geometry";
import { MAX_UNIT, type SnoObject, type SnoRef } from "@/lib/sno-parser";
import type { NostrEvent } from "@/types/nostr";
import type { SnoSceneNode } from "./scene";

/** A placed object once fetched and validated, with its own parts resolved. */
export interface ResolvedRef {
  object: SnoObject;
  children: SnoSceneNode[];
}

/** The identity of a reference, for the cycle check (§1.10). */
export function refKey(ref: SnoRef): string {
  return `${ref[0]}:${ref[1]}`;
}

/** The key an event itself answers to, so an object cannot place itself. */
export function eventRefKey(event: NostrEvent): string[] {
  const keys = [`e:${event.id}`];
  const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  if (event.kind === 33331) keys.push(`a:33331:${event.pubkey}:${d}`);
  return keys;
}

export function refPointer(ref: SnoRef): EventPointer | AddressPointer {
  const relays = ref[2] ? [ref[2]] : undefined;
  if (ref[0] === "e") return { id: ref[1], relays };
  const [kind, pubkey, ...rest] = ref[1].split(":");
  return { kind: Number(kind), pubkey, identifier: rest.join(":"), relays };
}

/**
 * §1.10: the scene nodes for an object's placements. Each distinct ref is
 * fetched once; every part that names it becomes a node. A ref that cannot be
 * fetched, fails validation, scales out of range, closes a cycle, or lies
 * deeper than the bound is a placeholder, never a rejection.
 */
export function placementNodes(
  parent: SnoObject,
  resolved: ReadonlyMap<number, ResolvedRef | null>,
  buffersFor: (object: SnoObject) => SnoSceneNode["buffers"],
): SnoSceneNode[] {
  return parent.parts.map((part, i) => {
    const got = resolved.get(part.ref);
    const placedUnit = got ? got.object.unit + part.step : NaN;
    if (got && placedUnit >= 0 && placedUnit <= MAX_UNIT) {
      return {
        key: `part-${i}`,
        ref: part.ref,
        name: got.object.name,
        matrix: partMatrix(part, parent.unit, got.object.unit),
        buffers: buffersFor(got.object),
        mode: got.object.mode,
        children: got.children,
      };
    }
    return {
      key: `part-${i}`,
      ref: part.ref,
      matrix: partMatrix({ ...part, step: 0 }, parent.unit, parent.unit),
      buffers: null,
      mode: "lines",
      children: [],
    };
  });
}

// Keyed by the SnoObject, which the event's own cache holds for as long as
// the EventStore holds the event: so in practice as strong as that cache,
// and released with it.
const buffersCache = new WeakMap<SnoObject, SnoSceneNode["buffers"]>();

/** The draw buffers of a validated object, built once per object. */
export function buffersFor(object: SnoObject): SnoSceneNode["buffers"] {
  let b = buffersCache.get(object);
  if (!b) {
    b = buildSnoBuffers(object);
    buffersCache.set(object, b);
  }
  return b;
}
