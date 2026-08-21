/**
 * One thread, beside its conversation.
 *
 * Layout only. The rows and the composer arrive as nodes because everything
 * that builds them — the adapter, the send path, the mention search, the
 * per-message context menu — already lives in `ChatViewer`, and reaching back
 * for it from here would either duplicate that wiring or import a cycle.
 *
 * Two shells, one body:
 *
 * - A COLUMN inside the chat window at `md` and up. Grimoire tiles its windows,
 *   so a Radix `Sheet` — which portals to `<body>` — would cover the workspace
 *   rather than the conversation, and dim every window the reader was comparing
 *   this thread against.
 * - The `Sheet` itself below `md`, where there is no room for a column and an
 *   overlay is the only honest answer.
 *
 * Not virtualized, deliberately. A thread is tens of rows, and a second
 * `Virtuoso` would need its own painted-container gate and its own bottom
 * anchor (`use-painted-container.ts`, `prepend-anchor.ts`) to earn nothing.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useIsMobile } from "@/hooks/useIsMobile";

interface ThreadPaneBodyProps {
  /** The message the thread hangs under, rendered as its own row. */
  root: ReactNode;
  /** The replies, oldest first. */
  replies: ReactNode;
  /** How many replies there are, for the heading. */
  count: number;
  /** The composer, or nothing when the reader cannot post here. */
  composer?: ReactNode;
  onClose: () => void;
}

function ThreadBody({
  root,
  replies,
  count,
  composer,
  onClose,
}: ThreadPaneBodyProps) {
  const scroller = useRef<HTMLDivElement>(null);

  // Newest reply first in view, matching how the channel opens. Runs on every
  // change to the reply count so a reply sent from here scrolls itself in.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [count]);

  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Thread
        </span>
        <span className="text-xs text-muted-foreground/70">
          {count} {count === 1 ? "reply" : "replies"}
        </span>
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-1">
        {root}
        {/* The root is the thread's subject, not one of its replies, so the
            line says which is which without a label. */}
        <div className="my-1 border-t" />
        {replies}
      </div>
      {composer}
    </>
  );
}

export function ThreadPane(props: ThreadPaneBodyProps) {
  // Escape closes it wherever it is rendered. Captured on the window rather
  // than a container, because the focus may be in the channel's composer — the
  // reader's hands are not necessarily inside the pane.
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // One shell or the other, never both. `SheetContent` brings a Radix overlay
  // that swallows pointer events for the whole document, so a `md:hidden` on the
  // content alone would leave the desktop workspace unclickable behind an
  // invisible sheet.
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0">
          <VisuallyHidden>
            <SheetTitle>Thread</SheetTitle>
          </VisuallyHidden>
          <ThreadBody {...props} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l">
      <ThreadBody {...props} />
    </aside>
  );
}
