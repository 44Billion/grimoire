/**
 * One thread, in a column beside its conversation.
 *
 * Layout only. The rows and the composer arrive as nodes because everything that
 * builds them — the adapter, the send path, the mention search, the per-message
 * context menu — already lives in `ChatViewer`, and reaching back for it from
 * here would either duplicate that wiring or import a cycle.
 *
 * **Always a column, never a takeover.** Two shapes were tried and both were
 * wrong. A Radix `Sheet` portals to `<body>`, so in a tiling layout it covers the
 * whole workspace — including the windows the reader opened to compare against —
 * and its overlay swallows pointer events document-wide. Replacing the
 * conversation when the window is narrow is worse in a subtler way: the
 * conversation disappears, so closing the thread reads as the tab having been
 * replaced and restored. So the column stays a column, and it gives way on WIDTH
 * instead: the caller passes the window's own measured width and the column is
 * clamped to a share of it, because these windows are tiled and a viewport media
 * query would call a 300px tile a desktop.
 *
 * Not virtualized, deliberately. A thread is tens of rows, and a second
 * `Virtuoso` would need its own painted-container gate and its own bottom anchor
 * (`use-painted-container.ts`, `prepend-anchor.ts`) to earn nothing.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Column width bounds. The ceiling is a share of the window, not a constant. */
const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 352;
const MAX_SHARE = 0.6;

/** How close to the bottom still counts as "following along", in pixels. */
const FOLLOW_SLACK = 80;

export interface ThreadPaneProps {
  /** The message the thread hangs under, rendered as its own row. */
  root: ReactNode;
  /** The replies, oldest first. */
  replies: ReactNode;
  /** How many replies there are, for the heading. */
  count: number;
  /** The composer, or nothing when the reader cannot post here. */
  composer?: ReactNode;
  /** Closes the THREAD. Never the window — see the note above. */
  onClose: () => void;
  /** The chat window's own width, once it has been measured. */
  windowWidth?: number;
  /** Requested column width, and how to change it by dragging. */
  width: number;
  onWidthChange: (width: number) => void;
}

export function ThreadPane({
  root,
  replies,
  count,
  composer,
  onClose,
  windowWidth,
  width,
  onWidthChange,
}: ThreadPaneProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  // Escape closes it wherever the focus is. On the window rather than a
  // container, because the reader's hands may be in the channel's composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A layer above already answered this Escape — a Radix dialog, tiptap's
      // mention dropdown. One keypress must close one thing, not the pane and
      // whatever was open on top of it.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Whether the reader is at the bottom is recorded as they scroll and consulted
  // when a reply arrives, so a reply landing while they read further up a long
  // thread does not yank them down to it.
  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (!box) return;
    following.current =
      box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_SLACK;
  }, []);

  useEffect(() => {
    const box = scroller.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [count]);

  // Clamped on every render, not only while dragging: a mosaic divider dragged
  // inwards shrinks the window under a column that was legal a moment ago.
  const ceiling = windowWidth
    ? Math.max(MIN_WIDTH, windowWidth * MAX_SHARE)
    : width;
  const applied = Math.min(Math.max(width, MIN_WIDTH), ceiling);

  // Pointer capture, not a document listener: it follows the pointer outside the
  // handle, ends on release wherever that happens, and needs no cleanup if the
  // pane unmounts mid-drag.
  const onHandleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = applied;
    handle.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent) => {
      // Dragging left widens: the handle is on the pane's LEFT edge.
      onWidthChange(startWidth - (move.clientX - startX));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l"
      style={{ width: `${applied}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize thread"
        onPointerDown={onHandleDown}
        onDoubleClick={() => onWidthChange(DEFAULT_WIDTH)}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
      />
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Thread
        </span>
        <span className="text-xs text-muted-foreground/70">
          {count} {count === 1 ? "reply" : "replies"}
        </span>
        {/* Right, where the window's own close is — this one closes the thread
            and nothing else. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-6 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title="Close thread (Esc)"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {/* No rule under the root. The pane's heading already says this is a
            thread, and a line across a 22rem column reads as a section break in
            a conversation that has none — the replies follow the message they
            answer, the way they do everywhere else. */}
        {root}
        {replies}
      </div>
      {composer}
    </aside>
  );
}

export { DEFAULT_WIDTH as THREAD_PANE_DEFAULT_WIDTH };
