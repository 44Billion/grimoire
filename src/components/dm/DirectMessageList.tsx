/**
 * The private conversations, above or below the communities in the sidebar.
 *
 * Rows are deliberately thin: a name, a time and a dot.
 * Everything that would need a relay to render — an avatar, a NIP-05 badge —
 * is left to `UserName`, which resolves reactively and caches, so a list of
 * thirty correspondents does not fan out thirty profile fetches from here.
 *
 * "Saved messages" — a conversation with yourself — sits at the top with its
 * own icon and is never marked unread. NIP-17 makes it fall out for free, and
 * people use it as a notepad rather than as correspondence.
 */

import { useState } from "react";
import { Bookmark, MessageSquare, Plus } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import { resolveRecipient } from "@/lib/dm/recipient";
import { cn } from "@/lib/utils";
import type { DmConversationSummary } from "@/hooks/useDirectMessages";

export function DirectMessageList({
  conversations,
  selected,
  onSelect,
}: {
  conversations: DmConversationSummary[];
  /** The open conversation's peer pubkey, if a DM is what is on screen. */
  selected?: string;
  onSelect: (peer: string) => void;
}) {
  return (
    <div className="flex flex-col">
      {/* No heading: the row this list hangs under already says what it is,
          exactly as a community's channels need no "Channels" label. */}
      <NewConversationInput onResolved={onSelect} />

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

/**
 * Paste someone in.
 *
 * Inline rather than behind a dialog: starting a conversation is one field and
 * one key, and a modal for that is more ceremony than the act. It sits above
 * the list because that is where the thing you are adding to the list goes.
 *
 * npub and nprofile only, the same rule the `chat` command follows — bare hex
 * is as plausibly an event id, and opening a private conversation with a
 * stranger because someone pasted the wrong thing is the wrong failure.
 */
function NewConversationInput({
  onResolved,
}: {
  onResolved: (peer: string) => void;
}) {
  const [value, setValue] = useState("");
  const [rejected, setRejected] = useState(false);

  const submit = () => {
    const peer = resolveRecipient(value);
    if (!peer) {
      setRejected(value.trim().length > 0);
      return;
    }
    setValue("");
    setRejected(false);
    onResolved(peer);
  };

  return (
    <div className="px-2 py-1">
      <div
        className={cn(
          "flex items-center gap-1 rounded border px-1.5 py-0.5",
          rejected && "border-destructive",
        )}
      >
        <Plus className="size-3 shrink-0 text-muted-foreground" />
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setRejected(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setValue("");
              setRejected(false);
            }
          }}
          placeholder="npub1… or nprofile1…"
          title="Paste an npub or nprofile to start a conversation"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
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
