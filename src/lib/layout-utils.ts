import type { MosaicNode } from "react-mosaic-component";
import type { LayoutConfig } from "@/types/app";

/**
 * Statistics about the layout tree structure
 */
export interface LayoutStats {
  /** Number of horizontal splits in the tree */
  rowSplits: number;
  /** Number of vertical splits in the tree */
  columnSplits: number;
  /** Maximum depth of the tree */
  depth: number;
  /** Total number of windows (leaf nodes) */
  windowCount: number;
}

/**
 * Information about a leaf node in the layout tree
 */
export interface LeafInfo {
  /** The window ID (leaf node value) */
  leafId: string;
  /** Depth of this leaf in the tree (root = 0) */
  depth: number;
  /** Direction of the parent split (null if no parent) */
  parentDirection: "row" | "column" | null;
}

/**
 * Analyzes the layout tree and returns statistics
 * Used by smart direction algorithm to balance splits
 */
export function analyzeLayoutStats(
  node: MosaicNode<string> | null
): LayoutStats {
  if (node === null) {
    return { rowSplits: 0, columnSplits: 0, depth: 0, windowCount: 0 };
  }

  if (typeof node === "string") {
    // Leaf node (window ID)
    return { rowSplits: 0, columnSplits: 0, depth: 0, windowCount: 1 };
  }

  // Branch node - recursively analyze children
  const firstStats = analyzeLayoutStats(node.first);
  const secondStats = analyzeLayoutStats(node.second);

  return {
    rowSplits:
      firstStats.rowSplits +
      secondStats.rowSplits +
      (node.direction === "row" ? 1 : 0),
    columnSplits:
      firstStats.columnSplits +
      secondStats.columnSplits +
      (node.direction === "column" ? 1 : 0),
    depth: Math.max(firstStats.depth, secondStats.depth) + 1,
    windowCount: firstStats.windowCount + secondStats.windowCount,
  };
}

/**
 * Finds all leaf nodes in the tree with their depth and parent direction
 */
export function findAllLeaves(
  node: MosaicNode<string> | null,
  depth: number = 0,
  parentDirection: "row" | "column" | null = null
): LeafInfo[] {
  if (node === null) {
    return [];
  }

  // Leaf node - return info
  if (typeof node === "string") {
    return [{ leafId: node, depth, parentDirection }];
  }

  // Branch node - recursively find leaves in children
  const leftLeaves = findAllLeaves(node.first, depth + 1, node.direction);
  const rightLeaves = findAllLeaves(node.second, depth + 1, node.direction);

  return [...leftLeaves, ...rightLeaves];
}

/**
 * Finds the shallowest leaf in the tree (closest to root = largest screen space)
 * If multiple leaves at same depth, returns first one encountered
 */
export function findShallowstLeaf(
  node: MosaicNode<string> | null
): LeafInfo | null {
  const leaves = findAllLeaves(node);

  if (leaves.length === 0) return null;

  // Find minimum depth
  const minDepth = Math.min(...leaves.map((leaf) => leaf.depth));

  // Return first leaf at minimum depth
  return leaves.find((leaf) => leaf.depth === minDepth) || null;
}

/**
 * Replaces a specific leaf node with a split containing the leaf + new window
 *
 * @param node - Current node in tree traversal
 * @param targetLeafId - ID of leaf to replace
 * @param newWindowId - ID of new window to insert
 * @param direction - Direction of the new split
 * @param splitPercentage - Split percentage for new split
 * @param position - Where to place new window ('first' or 'second')
 * @returns New tree with split at target leaf, or original tree if leaf not found
 */
export function replaceLeafWithSplit(
  node: MosaicNode<string> | null,
  targetLeafId: string,
  newWindowId: string,
  direction: "row" | "column",
  splitPercentage: number,
  position: "first" | "second" = "second"
): MosaicNode<string> | null {
  if (node === null) return null;

  // Leaf node - check if this is our target
  if (typeof node === "string") {
    if (node === targetLeafId) {
      // Found target! Replace with split
      const [first, second] =
        position === "first"
          ? [newWindowId, targetLeafId] // New window first
          : [targetLeafId, newWindowId]; // New window second (default)

      return {
        direction,
        first,
        second,
        splitPercentage,
      };
    }
    // Not our target, return unchanged
    return node;
  }

  // Branch node - recursively check children
  const newFirst = replaceLeafWithSplit(
    node.first,
    targetLeafId,
    newWindowId,
    direction,
    splitPercentage,
    position
  );
  const newSecond = replaceLeafWithSplit(
    node.second,
    targetLeafId,
    newWindowId,
    direction,
    splitPercentage,
    position
  );

  // Return new branch with potentially updated children
  return {
    direction: node.direction,
    first: newFirst!,
    second: newSecond!,
    splitPercentage: node.splitPercentage,
  };
}

/**
 * Calculates split direction for balanced insertion
 * Rotates parent direction 90° (row→column, column→row)
 * This creates a checkerboard pattern for more balanced layouts
 */
export function calculateBalancedDirection(
  parentDirection: "row" | "column" | null
): "row" | "column" {
  if (parentDirection === null) {
    return "row"; // Default to horizontal for first split
  }

  // Rotate 90 degrees
  return parentDirection === "row" ? "column" : "row";
}

/**
 * Inserts a new window into the layout tree according to the layout configuration
 *
 * Smart mode uses shallowest-leaf algorithm for balanced trees:
 * - Finds the leaf node at minimum depth (approximates largest visual space)
 * - Splits that leaf with direction rotated from parent (row→column, column→row)
 * - Creates more balanced layouts than root-level wrapping
 *
 * @param currentLayout - The current layout tree (null if no windows yet)
 * @param newWindowId - The ID of the new window to insert
 * @param config - Layout configuration specifying how to insert the window
 * @returns The new layout tree with the window inserted
 */
export function insertWindow(
  currentLayout: MosaicNode<string> | null,
  newWindowId: string,
  config: LayoutConfig
): MosaicNode<string> {
  // First window - just return the window ID as leaf node
  if (currentLayout === null) {
    return newWindowId;
  }

  // Smart mode: Use improved shallowest-leaf algorithm
  if (config.insertionMode === "smart") {
    // Find shallowest leaf to split (largest screen space)
    const leafInfo = findShallowstLeaf(currentLayout);

    if (!leafInfo) {
      // Shouldn't happen, but fallback to simple root insertion
      console.warn("[Layout] No leaf found, falling back to root insertion");
      return {
        direction: "row",
        first: currentLayout,
        second: newWindowId,
        splitPercentage: config.splitPercentage,
      };
    }

    // Determine split direction by rotating parent's direction
    const direction = calculateBalancedDirection(leafInfo.parentDirection);

    // Replace that leaf with a split
    const newLayout = replaceLeafWithSplit(
      currentLayout,
      leafInfo.leafId,
      newWindowId,
      direction,
      config.splitPercentage,
      config.insertionPosition
    );

    return newLayout || newWindowId; // Fallback if replacement failed
  }

  // Row/Column modes: Simple root-level wrapping (old behavior)
  const direction =
    config.insertionMode === "row"
      ? "row"
      : config.insertionMode === "column"
        ? "column"
        : "row";

  // Determine which side gets the new window
  const [firstNode, secondNode] =
    config.insertionPosition === "first"
      ? [newWindowId, currentLayout] // New window on left/top
      : [currentLayout, newWindowId]; // New window on right/bottom (default)

  // Create split node with new window
  return {
    direction,
    first: firstNode,
    second: secondNode,
    splitPercentage: config.splitPercentage,
  };
}
