import { useCallback, useEffect, useMemo, useState } from "react";
import type { AddressPointer } from "nostr-tools/nip19";
import {
  useBatchedAddressableEvent,
  useNostrEventState,
} from "@/hooks/useNostrEvent";
import { MAX_PART_DEPTH, type SnoObject, type SnoRef } from "@/lib/sno-parser";
import type { NostrEvent } from "@/types/nostr";
import {
  buffersFor,
  eventRefKey,
  placementNodes,
  refKey,
  refPointer,
  type ResolvedRef,
} from "./parts";
import type { SnoSceneNode } from "./scene";
import { useSnoObject } from "./useSnoObject";

interface PartNodeProps {
  index: number;
  ref_: SnoRef;
  context: NostrEvent;
  depth: number;
  chain: ReadonlySet<string>;
  onResolved: (index: number, value: ResolvedRef | null) => void;
}

/** Fetches one referenced object and resolves its own parts below it. */
function PartNode({
  index,
  ref_,
  context,
  depth,
  chain,
  onResolved,
}: PartNodeProps) {
  const pointer = useMemo(() => refPointer(ref_), [ref_]);
  // An `a` reference goes through the batched loader: the same tile under
  // fifty feed cards is one REQ per window rather than fifty.
  const addressed = useBatchedAddressableEvent(
    "identifier" in pointer ? (pointer as AddressPointer) : undefined,
  );
  const { event: byId } = useNostrEventState(
    "id" in pointer ? pointer : undefined,
    context,
  );
  const event = "identifier" in pointer ? addressed : byId;
  const [children, setChildren] = useState<SnoSceneNode[]>([]);

  const result = useSnoObjectOrNull(event);
  const object = result?.ok ? result.object : null;

  useEffect(() => {
    onResolved(index, object ? { object, children } : null);
  }, [index, object, children, onResolved]);

  // The chain carries both names of the fetched object, so a cycle written
  // as `a` one way and `e` the other is still a cycle (§1.10).
  const key = refKey(ref_);
  const nextChain = useMemo(
    () => new Set([...chain, key, ...(event ? eventRefKey(event) : [])]),
    [chain, key, event],
  );

  if (!object || !event || object.parts.length === 0) return null;
  return (
    <SnoPartsResolver
      object={object}
      context={event}
      depth={depth + 1}
      chain={nextChain}
      onChange={setChildren}
    />
  );
}

const EMPTY_EVENT: NostrEvent = {
  id: "",
  pubkey: "",
  kind: 0,
  created_at: 0,
  tags: [],
  content: "",
  sig: "",
};

/** `useSnoObject` for an event that may not have arrived yet. */
function useSnoObjectOrNull(event: NostrEvent | undefined) {
  // Hooks must run unconditionally; an absent event parses to nothing.
  const result = useSnoObject(event ?? EMPTY_EVENT);
  return event ? result : null;
}

export interface SnoPartsResolverProps {
  object: SnoObject;
  /** The event the object came from: relay hints for its refs. */
  context: NostrEvent;
  /** 1 for the parts of the object being rendered. */
  depth: number;
  /** Every ref key above this level, including the root's own. */
  chain: ReadonlySet<string>;
  onChange: (nodes: SnoSceneNode[]) => void;
}

interface ResolvedState {
  /** The object the map was built for; a different one starts over. */
  object: SnoObject;
  map: Map<number, ResolvedRef | null>;
}

const EMPTY_MAP: ReadonlyMap<number, ResolvedRef | null> = new Map();

/**
 * Renders nothing. Resolves an object's `refs`, builds a scene node per part
 * and hands the list up whenever it changes. Depth and cycles are bounded
 * here, which is the only kind of bound worth writing down (§1.10).
 */
export function SnoPartsResolver({
  object,
  context,
  depth,
  chain,
  onChange,
}: SnoPartsResolverProps) {
  const [state, setState] = useState<ResolvedState>(() => ({
    object,
    map: new Map(),
  }));
  // An addressable object replaced with different refs must not keep the
  // old entries; derived rather than reset in an effect.
  const resolved = state.object === object ? state.map : EMPTY_MAP;

  const onResolved = useCallback(
    (index: number, value: ResolvedRef | null) => {
      setState((prev) => {
        const same = prev.object === object;
        if (same && prev.map.get(index) === value) return prev;
        const next = new Map(same ? prev.map : undefined);
        next.set(index, value);
        return { object, map: next };
      });
    },
    [object],
  );

  const nodes = useMemo(
    () => placementNodes(object, resolved, buffersFor),
    [object, resolved],
  );

  useEffect(() => {
    onChange(nodes);
  }, [nodes, onChange]);

  if (depth > MAX_PART_DEPTH || object.parts.length === 0) return null;

  // One fetch per distinct ref that some part actually places.
  const placed = new Set(object.parts.map((p) => p.ref));
  return (
    <>
      {object.refs.map((ref, i) =>
        placed.has(i) && !chain.has(refKey(ref)) ? (
          <PartNode
            key={i}
            index={i}
            ref_={ref}
            context={context}
            depth={depth}
            chain={chain}
            onResolved={onResolved}
          />
        ) : null,
      )}
    </>
  );
}
