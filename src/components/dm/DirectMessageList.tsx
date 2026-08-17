/**
 * The private conversations, above or below the communities in the sidebar.
 *
 * Rows are deliberately thin: a name and, when there is one, a count.
 * Everything that would need a relay to render — an avatar, a NIP-05 badge —
 * is left to `UserName`, which resolves reactively and caches, so a list of
 * thirty correspondents does not fan out thirty profile fetches from here.
 *
 * "Saved messages" — a conversation with yourself — sits at the top with its
 * own icon and is never marked unread. NIP-17 makes it fall out for free, and
 * people use it as a notepad rather than as correspondence.
 */

import { AtSign, BellOff, Bookmark, Loader2, Pin, Plus } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import { RowMenu } from "@/components/chat/RowMenu";
import { MutedSection } from "@/components/chat/MutedSection";
import { cn } from "@/lib/utils";
import type { DmConversationSummary } from "@/hooks/useDirectMessages";
import type { BackfillProgress } from "@/services/dm-inbox";
import { DM_UNREAD_CAP } from "@/services/dm-store";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import { partitionPinned } from "@/lib/concord/channels";
import { dmRowRef } from "@/lib/dm/row-ref";

export function DirectMessageList({
  conversations,
  selected,
  onSelect,
  onCompose,
  backfill,
}: {
  conversations: DmConversationSummary[];
  /** The open conversation's peer pubkey, if a DM is what is on screen. */
  selected?: string;
  onSelect: (peer: string) => void;
  /** Open the dialog that starts one. */
  onCompose: () => void;
  /** The walk back through the whole history, while one is running. */
  backfill?: BackfillProgress;
}) {
  const { isRowPinned, isRowMuted } = useConcordPrefs();
  // Muted rows come off the list entirely and fold away at the bottom.
  const { pinned: muted, rest: listed } = partitionPinned(conversations, (c) =>
    isRowMuted(dmRowRef(c.conversationId)),
  );
  // "Saved messages" first and always, then the pinned, then the rest in the
  // order the list already had. Saved messages is not correspondence and is
  // never unread — it is where this account's own notes live — so it holds the
  // top whatever else the reader pins.
  const { pinned: saved, rest: others } = partitionPinned(
    listed,
    (c) => c.isSelf,
  );
  const { pinned, rest } = partitionPinned(others, (c) =>
    isRowPinned(dmRowRef(c.conversationId)),
  );
  const ordered = [...saved, ...pinned, ...rest];

  return (
    <div className="flex flex-col">
      {/* No heading: the row this list hangs under already says what it is,
          exactly as a community's channels need no "Channels" label. */}
      <button
        type="button"
        onClick={onCompose}
        className="flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <Plus className="size-3 flex-shrink-0" />
        <span className="truncate">New conversation</span>
      </button>

      {ordered.map((conversation) => (
        <DirectMessageRow
          key={conversation.conversationId}
          conversation={conversation}
          selected={conversation.peer === selected}
          onSelect={onSelect}
        />
      ))}

      {/* Saved messages is always present, so a row COUNT would call an empty
          list one conversation long. */}
      {conversations.every((c) => c.isSelf) && !backfill && (
        <p className="px-2 pb-1 text-xs text-muted-foreground">
          No conversations yet.
        </p>
      )}

      <MutedSection count={muted.length}>
        {muted.map((conversation) => (
          <DirectMessageRow
            key={conversation.conversationId}
            conversation={conversation}
            selected={conversation.peer === selected}
            onSelect={onSelect}
          />
        ))}
      </MutedSection>

      {/* The list grows while this runs — the walk rings the doorbell per page
          — so the line says what is still coming rather than blocking on it.
          Only ever shown on the first complete pass for a relay set. */}
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
  const { isRowPinned, toggleRowPin, isRowMuted, toggleRowMute } =
    useConcordPrefs();
  const row = dmRowRef(conversation.conversationId);
  const pinned = isRowPinned(row);
  const muted = isRowMuted(row);

  // Deliberately the same row as a Concord channel: `py-0.5`, a `size-3` icon,
  // one `ml-auto` group on the right. They sit in the same column under
  // sibling headings, and two rows that differ by two pixels of padding read
  // as a mistake rather than as a distinction.
  return (
    <RowMenu
      pinned={pinned}
      onTogglePin={() => toggleRowPin(row)}
      muted={muted}
      onToggleMute={() => toggleRowMute(row)}
    >
      <button
        type="button"
        onClick={() => onSelect(conversation.peer)}
        className={cn(
          "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
          selected && "bg-muted/70 font-medium",
          conversation.unread && !muted && "font-semibold text-foreground",
          muted && "text-muted-foreground",
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
        {/* A count when there is one, and nothing otherwise — the same
            right-hand side a channel row has. The relative time was there on
            every row whether or not it mattered, which made the rows that DID
            matter harder to find; recency is already what the list is sorted
            by. A muted row carries neither: silent is what it asked for. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          {muted && (
            <BellOff className="size-3 shrink-0 text-muted-foreground" />
          )}
          {!muted && conversation.unreadCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {conversation.unreadCount >= DM_UNREAD_CAP
                ? `${DM_UNREAD_CAP}+`
                : conversation.unreadCount}
            </span>
          )}
        </span>
      </button>
    </RowMenu>
  );
}
