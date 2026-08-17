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
 * Every conversation Hex remembers.
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

  if (others.length === 0) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
        <HexAvatar className="size-8" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Ask {HEX_NAME}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Nothing asked yet. Your extension picks the provider and model.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-3 pb-1 text-xs text-muted-foreground">
        {others.length} conversation{others.length === 1 ? "" : "s"}
      </div>
      {others.map((row) => (
        <div
          className="group flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-0 hover:bg-muted/40"
          key={row.windowId}
        >
          <button
            className="flex min-w-0 flex-1 flex-col items-start text-left"
            onClick={() =>
              // Opens in its own window, adopting the stored conversation.
              addWindow(
                "ai",
                { conversation: row.windowId },
                // The command that reproduces this window, so the edit box and
                // spellbooks can reopen the same conversation.
                `ai --conversation ${row.windowId}`,
                row.title.slice(0, 24),
              )
            }
            type="button"
          >
            <span className="w-full truncate text-sm">{row.title}</span>
            <span className="text-xs text-muted-foreground">
              {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} ·{" "}
              {formatTimestamp(
                Math.floor(row.updatedAt / 1000),
                "relative",
                locale,
              )}
            </span>
          </button>
          <button
            aria-label="Delete conversation"
            className="shrink-0 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={() => void deleteConversation(row.windowId)}
            title="Delete conversation"
            type="button"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
