/**
 * The row a folded thread leaves behind: how many replies, from whom, how long
 * ago.
 *
 * It has to answer "is there anything in here for me" without being opened,
 * because collapsing is the default and a bare count does not. Names are the
 * part that answers it, so up to three are spelled out.
 *
 * Deliberately NOT `UserName`, which is otherwise the rule for rendering a
 * pubkey: it opens a profile on click, and inside a button that both nests an
 * interactive element in another and fires two actions from one click. The row
 * IS the affordance, so the names render flat and the profile stays one click
 * away in the thread itself.
 */

import { MessageSquare } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { formatTimestamp } from "@/hooks/useLocale";
import type { ThreadSummary } from "@/lib/chat/threads";

/** How many repliers are named before the rest become a count. */
const NAMED_REPLIERS = 3;

/** A name, from whatever profile the store already holds. Never fetched here. */
function ReplierName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return <span className="truncate">{getDisplayName(pubkey, profile)}</span>;
}

export function ThreadSummaryButton({
  thread,
  onOpen,
  active,
  unread,
}: {
  thread: ThreadSummary;
  onOpen: () => void;
  /** Whether the pane is already showing this thread. */
  active?: boolean;
  /**
   * Replies the reader has not seen, when there are any.
   *
   * The channel's own "New messages" line cannot say this: it is placed over the
   * rendered rows, and these replies have none. Without the count the channel
   * badge names something with no way to find it.
   */
  unread?: number;
}) {
  const named = thread.repliers.slice(0, NAMED_REPLIERS);
  const rest = thread.repliers.length - named.length;
  const count = thread.replyIds.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={active}
      className={`mt-1 flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/60 ${
        active ? "bg-muted/60" : ""
      }`}
    >
      <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium text-primary">
        {count} {count === 1 ? "reply" : "replies"}
      </span>
      {!!unread && (
        <span className="shrink-0 rounded-full bg-primary px-1.5 font-medium text-primary-foreground">
          {unread} new
        </span>
      )}
      <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
        {named.map((pubkey, index) => (
          <span key={pubkey} className="truncate">
            <ReplierName pubkey={pubkey} />
            {index < named.length - 1 ? "," : null}
          </span>
        ))}
        {rest > 0 && <span className="shrink-0">+{rest}</span>}
      </span>
      {/* Last, and only when there is room: the count and the names are what
          the reader is deciding on. */}
      <span className="ml-auto hidden shrink-0 pl-1 text-muted-foreground/70 sm:inline">
        {formatTimestamp(thread.latest, "relative")}
      </span>
    </button>
  );
}
