/**
 * The private conversations, above or below the communities in the sidebar.
 *
 * Rows are deliberately thin: a name, a last-message preview, a time and a dot.
 * Everything that would need a relay to render — an avatar, a NIP-05 badge —
 * is left to `UserName`, which resolves reactively and caches, so a list of
 * thirty correspondents does not fan out thirty profile fetches from here.
 *
 * "Saved messages" — a conversation with yourself — sits at the top with its
 * own icon and is never marked unread. NIP-17 makes it fall out for free, and
 * people use it as a notepad rather than as correspondence.
 */

import { Bookmark, MessageSquare, Plus } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { DmConversationSummary } from "@/hooks/useDirectMessages";

export function DirectMessageList({
  conversations,
  selected,
  onSelect,
  onCompose,
}: {
  conversations: DmConversationSummary[];
  /** The open conversation's peer pubkey, if a DM is what is on screen. */
  selected?: string;
  onSelect: (peer: string) => void;
  onCompose: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Direct messages
        </span>
        <button
          type="button"
          onClick={onCompose}
          title="New message"
          className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Plus className="size-3" />
          <span className="sr-only">New message</span>
        </button>
      </div>

      {conversations.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        conversations.map((conversation) => (
          <DirectMessageRow
            key={conversation.conversationId}
            conversation={conversation}
            selected={conversation.peer === selected}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  );
}

function DirectMessageRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: DmConversationSummary;
  selected: boolean;
  onSelect: (peer: string) => void;
}) {
  const Icon = conversation.isSelf ? Bookmark : MessageSquare;
  const { locale } = useLocale();

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.peer)}
      className={cn(
        "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50",
        selected && "bg-muted/70 font-medium",
        conversation.unread && "font-semibold text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        {conversation.isSelf ? (
          "Saved messages"
        ) : (
          // `UserName` and nothing hand-rolled: it is what every other pubkey
          // in the app renders as, badges and click-through included.
          <UserName pubkey={conversation.peer} />
        )}
      </span>
      {conversation.lastAt > 0 && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatTimestamp(conversation.lastAt, "relative", locale)}
        </span>
      )}
      {conversation.unread && (
        <span
          aria-label="Unread messages"
          title="Unread messages"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
    </button>
  );
}
