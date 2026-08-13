import { useCallback, useRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

export interface FeedScrollTarget {
  index: 0 | "LAST";
  align: "start" | "end";
}

/**
 * Resolve a keypress to a feed scroll target, or null to leave it alone.
 *
 * Split out from the hook so the guard is testable without a DOM: text fields
 * inside feed items keep Home/End as caret movement.
 */
export function resolveFeedScrollTarget(
  key: string,
  target: { tagName?: string; isContentEditable?: boolean },
): FeedScrollTarget | null {
  if (key !== "Home" && key !== "End") return null;

  if (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA"
  ) {
    return null;
  }

  return key === "Home"
    ? { index: 0, align: "start" }
    : { index: "LAST", align: "end" };
}

/**
 * Home/End jump to the ends of a virtualized feed.
 *
 * Virtuoso's scroller is focusable, so the browser would otherwise scroll it
 * natively — but a native `scrollTop = 0` fights Virtuoso's height
 * re-estimation and lands short of the top. Routing through the handle (and
 * suppressing the native scroll) lets it correct as it goes.
 *
 * Hand `ref` to the Virtuoso and `onKeyDown` to any ancestor of it — keydown
 * bubbles up from the focused scroller.
 */
export function useFeedHomeEnd() {
  const ref = useRef<VirtuosoHandle>(null);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = resolveFeedScrollTarget(e.key, e.target as HTMLElement);
    if (!target) return;

    e.preventDefault();
    ref.current?.scrollToIndex(target);
  }, []);

  return { ref, onKeyDown };
}
