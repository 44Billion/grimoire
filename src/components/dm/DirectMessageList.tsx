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
import { AtSign, Bookmark, Loader2, Plus } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import { resolveRecipient } from "@/lib/dm/recipient";
import { cn } from "@/lib/utils";
import type { DmConversationSummary } from "@/hooks/useDirectMessages";
import type { BackfillProgress } from "@/services/dm-inbox";

export function DirectMessageList({
  conversations,
  selected,
  onSelect,
  backfill,
}: {
  conversations: DmConversationSummary[];
  /** The open conversation's peer pubkey, if a DM is what is on screen. */
  selected?: string;
  onSelect: (peer: string) => void;
  /** The walk back through the whole history, while one is running. */
  backfill?: BackfillProgress;
}) {
  return (
    <div className="flex flex-col">
      {/* No heading: the row this list hangs under already says what it is,
          exactly as a community's channels need no "Channels" label. */}
      <NewConversationInput onResolved={onSelect} />

      {conversations.length === 0 && !backfill ? (
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

      {/* The list grows while this runs — the walk rings the doorbell per page
          — so the line says what is still coming rather than blocking on it.
          Only ever shown on the first complete pass for an account. */}
      {backfill && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="truncate">
            reading older messages — {backfill.written} so far
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Paste someone in.
 *
 * Inline rather than behind a dialog: starting a conversation is one field and
 * one key, and a modal for that is more ceremony than the act. It sits above
 * the list because that is where the thing you are adding to the list goes,
 * and it is shaped like a row rather than like a search box for the same
 * reason the rows below it are shaped like channels.
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
    <div
      className={cn(
        "flex w-full items-center gap-1.5 px-2 py-0.5 text-sm",
        rejected && "text-destructive",
      )}
    >
      <Plus className="size-3 flex-shrink-0 text-muted-foreground" />
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
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
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
  const Icon = conversation.isSelf ? Bookmark : AtSign;
  const { locale } = useLocale();

  // Deliberately the same row as a Concord channel: `py-0.5`, a `size-3` icon,
  // one `ml-auto` group on the right. They sit in the same column under
  // sibling headings, and two rows that differ by two pixels of padding read
  // as a mistake rather than as a distinction.
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.peer)}
      className={cn(
        "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
        selected && "bg-muted/70 font-medium",
        conversation.unread && "font-semibold text-foreground",
      )}
    >
      <Icon className="size-3 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">
        {conversation.isSelf ? (
          "Saved messages"
        ) : (
          // `UserName` and nothing hand-rolled: it is what every other pubkey
          // in the app renders as, badges and click-through included. Not
          // clickable here — the row owns the click, and a name that opened a
          // profile instead of the conversation would be a trap.
          <UserName
            pubkey={conversation.peer}
            className="pointer-events-none"
          />
        )}
      </span>
      {/* ONE `ml-auto`, on the group — the same shape the channel row uses,
          and for the same reason: two auto margins split the free space and
          park the first item in the middle of the row. */}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {conversation.lastAt > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {formatTimestamp(conversation.lastAt, "relative", locale)}
          </span>
        )}
        {conversation.unread && (
          <span
            aria-label="Unread messages"
            title="Unread messages"
            className="size-1.5 rounded-full bg-primary"
          />
        )}
      </span>
    </button>
  );
}
