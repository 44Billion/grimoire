/**
 * The git repository a Concord channel is attached to, named in its header.
 *
 * The attachment is a coordinate, not a name (`armada.git`, read in
 * `lib/concord/git.ts`), so the identifier shows immediately and the NIP-34
 * announcement's `name` replaces it if and when the 30617 lands. The channel's
 * own relay hints ride both the lookup and the window this opens: a repository
 * announced only on its maintainer's relays is not on the reader's.
 */

import { useCallback, useMemo } from "react";
import { GitBranch } from "lucide-react";

import { useAddWindow } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getRepositoryName } from "@/lib/nip34-helpers";
import type { GitRepositoryAttachment } from "@/lib/concord/git";

export function ChannelRepoBadge({
  attachment,
}: {
  attachment: GitRepositoryAttachment;
}) {
  const addWindow = useAddWindow();
  const pointer = useMemo(
    () => ({
      kind: attachment.address.kind,
      pubkey: attachment.address.owner,
      identifier: attachment.address.identifier,
      ...(attachment.relayHints.length
        ? { relays: attachment.relayHints }
        : {}),
    }),
    [attachment],
  );
  const event = useNostrEvent(pointer);
  const name =
    (event ? getRepositoryName(event)?.trim() : undefined) ||
    attachment.address.identifier;

  const open = useCallback(() => {
    addWindow("open", { pointer });
  }, [addWindow, pointer]);

  return (
    <button
      type="button"
      onClick={open}
      title={`Repository ${attachment.address.coordinate}`}
      className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs leading-none hover:bg-muted"
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="max-w-32 truncate">{name}</span>
    </button>
  );
}
