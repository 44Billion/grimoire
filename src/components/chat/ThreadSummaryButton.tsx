/**
 * The row a folded thread leaves behind: who replied, and how many.
 *
 * Built to the same grammar as the session row directly above it
 * (`MessageSessions`), because a message can carry both and two sub-rows in
 * different shapes read as clutter rather than as a pair:
 *
 *     ● Hex               stopped              $ US$0.30
 *     ○ Hex, verbiricha   replied                    ⌸ 3
 *
 * An 8px marker in the same box as `StatusDot`, then names, then a verb, then one
 * figure on the right. A HOLLOW ring rather than a filled dot: same footprint, and
 * a coloured dot here would read as a second session status.
 *
 * Deliberately NOT `UserName`, which is otherwise the rule for rendering a
 * pubkey: it opens a profile on click, and inside a button that both nests an
 * interactive element in another and fires two actions from one click. The row IS
 * the affordance, so the names render flat and the profile stays one click away
 * in the thread itself.
 *
 * Fixed height and no wrapping, which is a scroll concern rather than a visual
 * one. This row grows under a message that is already on screen, and a name
 * arriving from the profile cache — or a fourth replier — must not change how
 * tall it is, or the timeline shifts under the reader.
 */

import { MessageSquare } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { BotMarker } from "@/components/nostr/BotMarker";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@/lib/chat/threads";

/** How many repliers are named before the rest become a `+n`. */
const NAMED_REPLIERS = 2;

/**
 * A name, from whatever profile the store already holds. Never fetched here.
 *
 * With the bot marker, for the same reason `UserName` carries it: the session row
 * above says an agent is running, and a reply row that did not mark the same
 * account as automation would read as a person having answered.
 */
function ReplierName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return (
    <>
      {getDisplayName(pubkey, profile)}
      <BotMarker pubkey={pubkey} className="ml-0.5 align-[-0.1em]" />
    </>
  );
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
   * rendered rows, and these replies have none. Without it the channel badge
   * names something with no way to find it.
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
      title={
        unread
          ? `${count} ${count === 1 ? "reply" : "replies"}, ${unread} unread`
          : `${count} ${count === 1 ? "reply" : "replies"}`
      }
      className={cn(
        "mt-1 flex h-5 w-full max-w-full items-center gap-1.5 whitespace-nowrap rounded px-1 text-left text-xs hover:bg-muted/50",
        active && "bg-muted/50",
      )}
    >
      <span className="flex h-2 w-2 shrink-0 items-center justify-center">
        <span
          className={cn(
            "h-2 w-2 rounded-full border",
            unread ? "border-primary bg-primary/30" : "border-muted-foreground",
          )}
        />
      </span>
      <span className="truncate font-medium text-foreground/80">
        {named.map((pubkey, index) => (
          <span key={pubkey}>
            {index > 0 && ", "}
            <ReplierName pubkey={pubkey} />
          </span>
        ))}
        {rest > 0 && ` +${rest}`}
      </span>
      <span className="truncate text-muted-foreground">replied</span>
      {/* The right-hand figure, in the slot and the type the session row puts
          its spend in. Accented when some of it is unread — a word would say the
          same thing and take a third of the row to do it. */}
      <span
        className={cn(
          "ml-auto flex shrink-0 items-center gap-0.5 pl-2 font-mono text-[10px]",
          unread ? "text-primary" : "text-muted-foreground/70",
        )}
      >
        <MessageSquare className="h-2.5 w-2.5" />
        {count}
      </span>
    </button>
  );
}
