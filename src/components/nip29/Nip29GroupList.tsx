/**
 * The reader's NIP-29 groups, as sidebar rows under the "Groups" heading.
 *
 * The same row as a Concord channel and a private conversation — `py-0.5`, a
 * `size-3` icon, one `ml-auto` group — because all three hang in one column
 * under sibling headings, and rows that differ by two pixels read as a mistake
 * rather than as a distinction. Deliberately NOT `GroupListViewer`'s two-line
 * row with its last-message preview: that list is the whole window, this one is
 * a section sharing a narrow column with two others.
 *
 * Sorted by last message upstream, in `useNip29Groups`.
 */

import { BellOff, Hash, Pin } from "lucide-react";
import { useGroupMetadata } from "@/hooks/useGroupMetadata";
import { RowMenu } from "@/components/chat/RowMenu";
import { UnreadBadge } from "@/components/concord/ConcordChannelList";
import type { GroupUnread } from "@/lib/nip29/unread";
import { MutedSection } from "@/components/chat/MutedSection";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import { groupRowRef } from "@/lib/nip29/row-ref";
import { partitionPinned } from "@/lib/concord/channels";
import { cn } from "@/lib/utils";
import type { GroupEntry } from "@/hooks/useNip29GroupList";
import { groupKey, type GroupSelection } from "@/lib/nip29/group-selection";

function relayHost(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

export function Nip29GroupList({
  groups,
  selected,
  onSelect,
  loading,
  unread,
  onMarkRead,
}: {
  groups: GroupEntry[];
  selected?: GroupSelection | undefined;
  onSelect: (selection: GroupSelection) => void;
  loading?: boolean;
  /** What each group has waiting, keyed as {@link groupKey}. */
  unread?: Map<string, GroupUnread>;
  /** Stamps a group read without opening it, at its newest counted message. */
  onMarkRead?: (selection: GroupSelection, latest: number) => void;
}) {
  const { isRowPinned, isRowMuted } = useConcordPrefs();

  // Muted groups leave the list and fold away at the bottom.
  const { pinned: muted, rest: listed } = partitionPinned(groups, (g) =>
    isRowMuted(groupRowRef(g)),
  );
  // Pinned above the rest, and only then by recency. A pin is the reader
  // overriding the sort, which is the only thing a pin can mean in a list that
  // already orders itself.
  const { pinned, rest } = partitionPinned(listed, (g) =>
    isRowPinned(groupRowRef(g)),
  );
  const ordered = [...pinned, ...rest];

  if (groups.length === 0)
    return (
      <p className="px-2 pb-1 text-xs text-muted-foreground">
        {loading
          ? "Looking for your groups…"
          : "No groups yet. Join one with `chat relay.example.com'group-id`."}
      </p>
    );

  return (
    <div className="flex flex-col">
      {ordered.map((group) => (
        <Nip29GroupRow
          key={groupKey(group)}
          group={group}
          selected={!!selected && groupKey(selected) === groupKey(group)}
          onSelect={onSelect}
          {...(unread?.get(groupKey(group))
            ? { unread: unread.get(groupKey(group)) }
            : {})}
          {...(onMarkRead ? { onMarkRead } : {})}
        />
      ))}
      <MutedSection count={muted.length}>
        {muted.map((group) => (
          <Nip29GroupRow
            key={groupKey(group)}
            group={group}
            selected={!!selected && groupKey(selected) === groupKey(group)}
            onSelect={onSelect}
          />
        ))}
      </MutedSection>
    </div>
  );
}

function Nip29GroupRow({
  group,
  selected,
  onSelect,
  unread,
  onMarkRead,
}: {
  group: GroupEntry;
  selected: boolean;
  onSelect: (selection: GroupSelection) => void;
  unread?: GroupUnread | undefined;
  onMarkRead?:
    ((selection: GroupSelection, latest: number) => void) | undefined;
}) {
  // `_` is NIP-29's unmanaged group: every message on the relay that names no
  // group. It has no kind-39000 metadata to resolve, so the relay IS the name.
  const unmanaged = group.groupId === "_";
  const metadata = useGroupMetadata(group.groupId, group.relayUrl);
  const name = unmanaged
    ? relayHost(group.relayUrl)
    : metadata?.name || group.groupId;

  const { isRowPinned, toggleRowPin, isRowMuted, toggleRowMute } =
    useConcordPrefs();
  const row = groupRowRef(group);
  const pinned = isRowPinned(row);
  const muted = isRowMuted(row);
  const selection = { groupId: group.groupId, relayUrl: group.relayUrl };
  // A muted row is the reader saying they do not want to be told, so it carries
  // no badge and needs no way to clear one — same as a muted Concord channel.
  const waiting = !muted && (unread?.count ?? 0) > 0 ? unread : undefined;

  return (
    <RowMenu
      pinned={pinned}
      onTogglePin={() => toggleRowPin(row)}
      muted={muted}
      onToggleMute={() => toggleRowMute(row)}
      {...(waiting && waiting.latest > 0 && onMarkRead
        ? { onMarkRead: () => onMarkRead(selection, waiting.latest) }
        : {})}
    >
      <button
        type="button"
        onClick={() => onSelect(selection)}
        className={cn(
          "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
          selected && "bg-muted/70 font-medium",
          muted && "text-muted-foreground",
          waiting && "font-semibold text-foreground",
        )}
        // The relay, because two groups can share a name and only the host
        // tells them apart — in the title rather than the row, which has no
        // width for it.
        title={
          unmanaged ? group.relayUrl : `${name} — ${relayHost(group.relayUrl)}`
        }
      >
        <Hash className="size-3 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
          {muted && (
            <BellOff className="size-3 shrink-0 text-muted-foreground" />
          )}
          {waiting && <UnreadBadge unread={waiting} />}
        </span>
      </button>
    </RowMenu>
  );
}
