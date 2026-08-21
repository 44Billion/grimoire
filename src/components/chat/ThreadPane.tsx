/**
 * One thread, in a column beside its conversation.
 *
 * Layout only. The rows and the composer arrive as nodes because everything that
 * builds them — the adapter, the send path, the mention search, the per-message
 * context menu — already lives in `ChatViewer`, and reaching back for it from
 * here would either duplicate that wiring or import a cycle.
 *
 * **A column when there is room for one; the whole window when there is not.**
 * Two shapes stay rejected outright. A Radix `Sheet` portals to `<body>`, so in
 * a tiling layout it covers the whole workspace — including the windows the
 * reader opened to compare against — and its overlay swallows pointer events
 * document-wide. And a viewport media query is the wrong instrument for "is
 * there room": these windows are tiled, so one can be 300px wide on a large
 * display and `matchMedia` would still call it a desktop. So this reads the
 * window's own measured width, never the viewport's — see `thread-pane-layout.ts`
 * for what it does with that width, and for the floor-vs-floor bug it fixes.
 *
 * Below the width a column needs, there is no honest column to draw, so the
 * pane takes the window's full width and a back arrow replaces the resize
 * handle nobody could grab anyway. It still only takes ITS OWN window, never
 * the workspace, and the conversation underneath is hidden rather than
 * unmounted, so back returns to it exactly as it was.
 *
 * Not virtualized, deliberately. A thread is tens of rows, and a second
 * `Virtuoso` would need its own painted-container gate and its own bottom anchor
 * (`use-painted-container.ts`, `prepend-anchor.ts`) to earn nothing.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { layoutThreadPane } from "./thread-pane-layout";

/** The default width a double-click on the resize handle restores. */
const DEFAULT_WIDTH = 352;

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
  const pane = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  /**
   * Escape closes the thread — but only when nothing else has claim to it.
   *
   * A window listener alone closed the pane AND whatever was open on top of it:
   * a context menu, an emoji picker, tiptap's mention dropdown. `defaultPrevented`
   * does not catch that, because Radix closes on its own key handling without
   * marking the event. So the test is focus. A layer that is open has taken it,
   * and this stays out of the way; focus inside the pane, or nowhere at all —
   * which is where it sits right after the row that opened this was clicked — is
   * an Escape meant for the thread.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      const focused = document.activeElement;
      const loose = !focused || focused === document.body;
      if (loose || pane.current?.contains(focused)) onClose();
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

  // Recomputed on every render, not only while dragging: a mosaic divider
  // dragged inwards shrinks the window under a column that was legal a moment
  // ago, and a phone stays collapsed until it is turned.
  const { width: applied, collapsed } = layoutThreadPane(windowWidth, width);

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
      ref={pane}
      className={cn(
        "relative flex shrink-0 flex-col",
        // Collapsed, the pane IS the window's content — a border on its own
        // left edge would just double the window's, and there is nothing left
        // of it to drag a divider against.
        !collapsed && "border-l",
      )}
      style={{ width: `${applied}px` }}
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize thread"
          onPointerDown={onHandleDown}
          onDoubleClick={() => onWidthChange(DEFAULT_WIDTH)}
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
        />
      )}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        {collapsed && (
          // Left, mobile-nav style — this window is nothing but the thread
          // right now, so "back" reads truer than a corner "x".
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-1 size-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title="Back to conversation"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        )}
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Thread
        </span>
        <span className="text-xs text-muted-foreground/70">
          {count} {count === 1 ? "reply" : "replies"}
        </span>
        {!collapsed && (
          // Right, where the window's own close is — this one closes the
          // thread and nothing else.
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
        )}
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
