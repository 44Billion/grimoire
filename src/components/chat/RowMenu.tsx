/**
 * Right-click a sidebar row for what can be done to it: pin it to the top of
 * its section, mute it, or copy the identifier that names it.
 *
 * One menu for all three families — a Concord channel, a private conversation,
 * a NIP-29 group — because all three are rows in one column and a reader who
 * learns the gesture in one should not find it missing in the next. Both
 * settings are per-device and never published (`src/services/concord-prefs.ts`).
 *
 * Muted means SILENT, not hidden: the row stays where it is, it just stops
 * carrying a count and stops adding to the totals above it.
 */

import type { ReactNode } from "react";
import { Bell, BellOff, CheckCheck, Copy, Pin, PinOff } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function RowMenu({
  pinned,
  onTogglePin,
  muted,
  onToggleMute,
  onMarkRead,
  onCopyId,
  children,
}: {
  pinned?: boolean;
  onTogglePin?: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
  /** Only passed when there is something unread to clear. */
  onMarkRead?: () => void;
  /** Put the row's own identifier on the clipboard. */
  onCopyId?: () => void;
  children: ReactNode;
}) {
  // No menu at all where nothing can be done — an empty one that opens on
  // right-click is worse than the browser's own.
  if (!onTogglePin && !onToggleMute && !onMarkRead && !onCopyId)
    return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        {onMarkRead && (
          <ContextMenuItem onSelect={onMarkRead}>
            <CheckCheck className="size-4 mr-2" />
            Mark as read
          </ContextMenuItem>
        )}
        {onTogglePin && (
          <ContextMenuItem onSelect={onTogglePin}>
            {pinned ? (
              <PinOff className="size-4 mr-2" />
            ) : (
              <Pin className="size-4 mr-2" />
            )}
            {pinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
        )}
        {onToggleMute && (
          <ContextMenuItem onSelect={onToggleMute}>
            {muted ? (
              <Bell className="size-4 mr-2" />
            ) : (
              <BellOff className="size-4 mr-2" />
            )}
            {muted ? "Unmute" : "Mute"}
          </ContextMenuItem>
        )}
        {onCopyId && (
          <ContextMenuItem onSelect={onCopyId}>
            <Copy className="size-4 mr-2" />
            Copy ID
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
