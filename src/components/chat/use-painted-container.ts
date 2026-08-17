/**
 * Hold a virtualized list back until there is something to measure it against.
 *
 * react-virtuoso opens a channel at its newest message with
 * `initialTopMostItemIndex`, and implements it by keeping the item list
 * `visibility: hidden` until that initial scroll reaches its final location.
 * Reaching it needs a measurement, and a measurement needs a laid-out container
 * in a document that is painting. Mount before either is true — a mosaic tile
 * mid-split, a workspace that was not on screen, a tab the browser had stopped
 * rendering — and the scroll never lands. Nothing in the library retries it: the
 * list stays hidden with zero rows for as long as the window is open. That is
 * the blank timeline.
 *
 * So don't mount it there. `requestAnimationFrame` does not run in a document
 * that is not painting — measured: zero callbacks in twenty-five seconds on a
 * backgrounded tab — which makes it the exact test for the condition the library
 * needs, and the callback then checks the container has a height. Both are true
 * on an ordinary open within one frame, so the cost is a single frame of an
 * empty pane; in the cases that used to blank, the list mounts later, the first
 * moment it can succeed.
 *
 * **Per mount, not per component.** The list unmounts and remounts whenever the
 * timeline empties — which is every channel switch — so a gate that opened once
 * and stayed open would let every switch after the first mount into nothing.
 * That is exactly the common way into a blank pane, and it is why this takes a
 * key rather than a bare boolean.
 *
 * This replaces a watchdog that noticed the blank after the fact and remounted
 * the list to clear it. That worked only sometimes: whatever starved the first
 * measurement starves the remount identically, so the recovery also had to drop
 * `initialTopMostItemIndex`, scroll by hand, and retry the scroll — three
 * mechanisms, and a window in which the reader sees an empty channel. Waiting
 * is cheaper than recovering, and leaves nothing to recover from.
 */

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function usePaintedContainer<T extends HTMLElement>(
  /** Changes whenever the thing being gated is about to mount afresh. */
  mountKey: string,
): { ref: RefObject<T | null>; painted: boolean } {
  const ref = useRef<T>(null);
  const [paintedFor, setPaintedFor] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (paintedFor === mountKey) return;
    let frame = 0;
    // A poll rather than a one-shot: the frame after mount is usually enough,
    // but a tile still being sized reports zero height for a few of them, and a
    // ResizeObserver would answer the size question without answering the
    // painting one. It ends on the first frame that satisfies both, so on an
    // ordinary open it runs exactly once.
    const check = () => {
      if ((ref.current?.getBoundingClientRect().height ?? 0) > 0) {
        setPaintedFor(mountKey);
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [mountKey, paintedFor]);

  return { ref, painted: paintedFor === mountKey };
}
