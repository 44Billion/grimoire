import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";

import { HexAvatar, HEX_NAME } from "./Hex";

import { useAddWindow } from "@/core/state";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import {
  deleteConversation,
  listConversations,
} from "@/services/ai-conversations";

/**
 * Every conversation Hex remembers, one line each.
 *
 * `ai` with no arguments lands here rather than on an empty chat: the useful
 * default for a window that persists its turns is to show what is already
 * there. Typing in the composer below starts a new one in place.
 */
export function ConversationIndex({
  currentWindowId,
}: {
  currentWindowId?: string;
}) {
  const { locale } = useLocale();
  const addWindow = useAddWindow();
  const conversations = useLiveQuery(() => listConversations(), []);
  const others = (conversations ?? []).filter(
    (row) => row.windowId !== currentWindowId,
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <HexAvatar />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Recent conversations
        </span>
      </div>

      {others.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Nothing asked yet. Ask {HEX_NAME} above to start one.
        </p>
      ) : (
        others.map((row) => (
          <div
            className="group flex items-baseline gap-2 px-3 py-1 hover:bg-muted/40"
            key={row.windowId}
          >
            <button
              className="min-w-0 flex-1 truncate text-left text-sm"
              onClick={() =>
                // Opens in its own window, adopting the stored conversation.
                addWindow(
                  "ai",
                  { conversation: row.windowId },
                  // The command that reproduces this window, so the edit box
                  // and spellbooks reopen the same conversation.
                  `ai --conversation ${row.windowId}`,
                  row.title.slice(0, 24),
                )
              }
              title={row.title}
              type="button"
            >
              {row.title}
            </button>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {formatTimestamp(
                Math.floor(row.updatedAt / 1000),
                "relative",
                locale,
              )}
            </span>
            <button
              aria-label="Delete conversation"
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => void deleteConversation(row.windowId)}
              title="Delete conversation"
              type="button"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
