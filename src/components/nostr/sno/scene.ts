import type { SnoBuffers } from "@/lib/sno-geometry";
import type { SnoMode } from "@/lib/sno-parser";

/**
 * One node of the tree a canvas draws: an object, or a placeholder where an
 * object that could not be fetched would stand (DECK-0003 §1.10). `matrix`
 * is column-major, relative to the parent. Children are placed objects.
 */
export interface SnoSceneNode {
  key: string;
  matrix: number[];
  /** `null` is a placeholder: a wireframe unit cube in the theme's info color. */
  buffers: SnoBuffers | null;
  mode: SnoMode;
  /** Grid half-width in model units; only the root carries one. */
  extent?: number;
  /** For a placed object: which `refs` entry it came from, and its name once fetched. */
  ref?: number;
  name?: string;
  children: SnoSceneNode[];
}

export const IDENTITY: number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/** How many placements in the tree are drawn as placeholders. */
export function countPlaceholders(node: SnoSceneNode): number {
  let n = 0;
  for (const child of node.children) {
    if (child.buffers === null) n++;
    n += countPlaceholders(child);
  }
  return n;
}
