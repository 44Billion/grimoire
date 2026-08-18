import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";

import { HexAvatar, HEX_NAME } from "./Hex";

import { RichText } from "@/components/nostr/RichText";

import { useAddWindow } from "@/core/state";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import {
  deleteConversation,
  listConversations,
} from "@/services/ai-conversations";

/**
 * A conversation's first question, with its mentions as names.
 *
 * A title is one line, so a person becomes their name and an event becomes a
 * short label — the block embed a reply uses would not fit, and a raw
 * `nostr:npub1…` told the reader nothing about which conversation this was.
 */
function ConversationTitle({ title }: { title: string }) {
  return (
    <RichText
      className="truncate"
      content={title}
      // A row is one line: no media, and an event reference stays a link rather
      // than becoming the embed a reply gets.
      options={{ showMedia: false, showEventEmbeds: false }}
    />
  );
}

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

  // Nothing to list is not a list with a note in it: with no history the window
  // has one thing to say, so it says it in the middle rather than in a corner.
  if (others.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <HexAvatar className="size-8" />
        <p className="max-w-xs text-sm text-muted-foreground">
          Nothing asked yet. Ask {HEX_NAME} above to start a conversation.
        </p>
      </div>
    );
  }

  return (
    // Centred and bounded like the composer above it: the index is a page, and
    // a full-width tile stretches four words of title across a metre of screen.
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <div className="px-3 pb-1 pt-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Recent conversations
        </span>
      </div>

      {others.map((row) => (
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
            <ConversationTitle title={row.title} />
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
      ))}
    </div>
  );
}
