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

import { Hash } from "lucide-react";
import { useGroupMetadata } from "@/hooks/useGroupMetadata";
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
}: {
  groups: GroupEntry[];
  selected?: GroupSelection | undefined;
  onSelect: (selection: GroupSelection) => void;
  loading?: boolean;
}) {
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
      {groups.map((group) => (
        <Nip29GroupRow
          key={groupKey(group)}
          group={group}
          selected={!!selected && groupKey(selected) === groupKey(group)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function Nip29GroupRow({
  group,
  selected,
  onSelect,
}: {
  group: GroupEntry;
  selected: boolean;
  onSelect: (selection: GroupSelection) => void;
}) {
  // `_` is NIP-29's unmanaged group: every message on the relay that names no
  // group. It has no kind-39000 metadata to resolve, so the relay IS the name.
  const unmanaged = group.groupId === "_";
  const metadata = useGroupMetadata(group.groupId, group.relayUrl);
  const name = unmanaged
    ? relayHost(group.relayUrl)
    : metadata?.name || group.groupId;

  return (
    <button
      type="button"
      onClick={() =>
        onSelect({ groupId: group.groupId, relayUrl: group.relayUrl })
      }
      className={cn(
        "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
        selected && "bg-muted/70 font-medium",
      )}
      // The relay, because two groups can share a name and only the host tells
      // them apart — in the title rather than the row, which has no width for it.
      title={
        unmanaged ? group.relayUrl : `${name} — ${relayHost(group.relayUrl)}`
      }
    >
      <Hash className="size-3 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </button>
  );
}
