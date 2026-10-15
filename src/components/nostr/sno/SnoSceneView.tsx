import { useEffect, useMemo, useState } from "react";
import type { SnoMode, SnoObject } from "@/lib/sno-parser";
import type { NostrEvent } from "@/types/nostr";
import { LazySnoCanvas } from "./LazySnoCanvas";
import { buffersFor, eventRefKey } from "./parts";
import { countPlaceholders, IDENTITY, type SnoSceneNode } from "./scene";
import { SnoPartsResolver } from "./SnoPartsResolver";

interface SnoSceneViewProps {
  event: NostrEvent;
  object: SnoObject;
  mode?: SnoMode;
  interactive?: boolean;
  autoRotate?: boolean;
  className?: string;
  /** The placed objects as they resolve, for a parts list beside the canvas. */
  onParts?: (nodes: SnoSceneNode[]) => void;
}

/**
 * An object and everything it places, as one canvas. The parts resolver
 * fetches placed objects in the background; the canvas redraws as they land,
 * and a caption counts the placements still drawn as placeholders.
 */
export function SnoSceneView({
  event,
  object,
  mode,
  interactive,
  autoRotate,
  className,
  onParts,
}: SnoSceneViewProps) {
  const [children, setChildren] = useState<SnoSceneNode[]>([]);
  const buffers = useMemo(() => buffersFor(object), [object]);
  const chain = useMemo(() => new Set(eventRefKey(event)), [event]);

  const root = useMemo<SnoSceneNode>(
    () => ({
      key: "root",
      matrix: IDENTITY,
      buffers,
      mode: object.mode,
      extent: object.extent,
      children,
    }),
    [buffers, object, children],
  );

  useEffect(() => {
    onParts?.(children);
  }, [children, onParts]);

  const missing = countPlaceholders(root);
  const label = [
    object.name || "Untitled object",
    `${object.vertices.length} vertices`,
    `${object.faces.length} faces`,
    `${mode ?? object.mode} view`,
  ].join(", ");

  return (
    <div className="relative">
      {object.parts.length > 0 && (
        <SnoPartsResolver
          object={object}
          context={event}
          depth={1}
          chain={chain}
          onChange={setChildren}
        />
      )}
      <LazySnoCanvas
        root={root}
        mode={mode}
        interactive={interactive}
        autoRotate={autoRotate}
        className={className}
        label={label}
      />
      {missing > 0 && (
        <div className="pointer-events-none absolute bottom-1 left-2 text-xs text-muted-foreground">
          {missing} {missing === 1 ? "part" : "parts"} not fetched, drawn as
          cubes
        </div>
      )}
    </div>
  );
}
